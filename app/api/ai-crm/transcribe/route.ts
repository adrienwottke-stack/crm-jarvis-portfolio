import { createHash } from "node:crypto";
import { parseBuffer } from "music-metadata";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  aiCrmConfig,
  estimateAudioCostMicros,
} from "@/lib/ai-crm/config";
import {
  claimAiUsage,
  completeAiUsage,
  requireAiEntitlement,
} from "@/lib/ai-crm/entitlement";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { openAiClient } from "@/lib/ai-crm/openai";
import { validateAudioEnvelope } from "@/lib/ai-crm/audio";
import { bindWorkRequest, bindWorkUsage, validateAiWorkTask } from "@/lib/workflows/service";
import { PRICING_VERSION } from "@/lib/ai-crm/provider-metering";
import {
  claimAiRequest,
  completeAiRequest,
  failAiRequest,
  hashAiRequestInput,
} from "@/lib/ai-crm/requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidSchema = z.uuid();

function isAbort(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

export async function POST(request: Request) {
  const started = Date.now();
  let usageId: string | null = null;
  let aiRequestId: string | null = null;
  let userId: string | null = null;
  try {
    if (!sameOrigin(request)) {
      throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    }
    const user = await requireUser();
    userId = user.id;
    const config = aiCrmConfig();
    await requireAiEntitlement(prisma, user.id, new Date(), config);
    const data = await request.formData();
    const audio = data.get("audio");
    const clientRequestId = data.get("clientRequestId");
    const suppliedTask = data.get("workTaskId");
    if (suppliedTask !== null && (typeof suppliedTask !== "string" || !suppliedTask || suppliedTask.length > 120)) throw new AiCrmError("INVALID_REQUEST", "Die Arbeit konnte nicht sicher zugeordnet werden.", 400);
    const workTask = typeof suppliedTask === "string" ? await validateAiWorkTask(prisma, user.id, suppliedTask) : null;
    const reportedDuration = Number(data.get("durationSeconds") ?? Number.NaN);
    if (!(audio instanceof File) || typeof clientRequestId !== "string") {
      throw new AiCrmError(
        "INVALID_AUDIO",
        "Bitte nimm die Nachricht erneut auf.",
      );
    }
    const parsedClientRequestId = uuidSchema.safeParse(clientRequestId);
    if (!parsedClientRequestId.success) {
      throw new AiCrmError(
        "INVALID_REQUEST",
        "Die Aufnahme konnte nicht sicher zugeordnet werden. Bitte nimm sie erneut auf.",
      );
    }
    if (audio.size <= 0 || audio.size > config.maxAudioBytes) {
      throw new AiCrmError(
        audio.size > config.maxAudioBytes ? "AUDIO_TOO_LARGE" : "INVALID_AUDIO",
        audio.size > config.maxAudioBytes
          ? "Die Aufnahme ist zu groß. Bitte teile sie in eine kürzere Nachricht."
          : "Bitte nimm die Nachricht erneut auf.",
        audio.size > config.maxAudioBytes ? 413 : 400,
      );
    }
    const bytes = new Uint8Array(await audio.arrayBuffer());
    let actualDuration: number;
    try {
      const metadata = await parseBuffer(bytes, {
        mimeType: audio.type,
        size: audio.size,
      });
      actualDuration = metadata.format.duration ?? Number.NaN;
    } catch {
      throw new AiCrmError(
        "INVALID_AUDIO_DURATION",
        "Die Aufnahmedauer konnte nicht sicher erkannt werden. Bitte nimm die Nachricht erneut auf.",
      );
    }
    const validated = validateAudioEnvelope({
      mimeType: audio.type,
      size: audio.size,
      reportedDuration,
      actualDuration,
      maxAudioBytes: config.maxAudioBytes,
      maxAudioSeconds: config.maxAudioSeconds,
    });
    const audioHash = createHash("sha256").update(bytes).digest("hex");
    const now = new Date();
    const claimed = await claimAiRequest(prisma, {
      userId: user.id,
      clientRequestId: parsedClientRequestId.data,
      kind: "TRANSCRIPTION",
      inputHash: hashAiRequestInput({
        ...(workTask ? { workTaskId: workTask.id } : {}),
        audioHash,
        mimeType: validated.mimeType,
        durationSeconds: Math.round(validated.durationSeconds * 1000) / 1000,
      }),
      now,
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      staleAfterMs: config.providerTimeoutMs + 15_000,
    });
    aiRequestId = claimed.request.id;
    if (claimed.kind === "REPLAY") {
      if (workTask) await bindWorkRequest(prisma, user.id, workTask.id, claimed.request.id, "TRANSCRIPTION", now);
      return Response.json(claimed.response, {
        headers: { "Cache-Control": "no-store", "X-AI-Replayed": "1" },
      });
    }
    if (claimed.kind === "IN_PROGRESS") {
      throw new AiCrmError(
        "REQUEST_IN_PROGRESS",
        "Diese Aufnahme wird bereits verarbeitet. Bitte warte einen Moment.",
        409,
      );
    }
    const usage = await claimAiUsage(
      prisma,
      user.id,
      "TRANSCRIPTION",
      now,
      config,
      claimed.request.id,
    );
    usageId = usage.id;
    if (workTask) { await bindWorkRequest(prisma, user.id, workTask.id, claimed.request.id, "TRANSCRIPTION", now); await bindWorkUsage(prisma, user.id, workTask.id, usage.id); }
    // One explicit provider attempt. Reported seconds/tokens do not supply a
    // complete verified transcription tariff, so priced cost remains unknown.
    await prisma.aiUsage.update({ where: { id: usage.id }, data: { providerAttempts: { increment: 1 }, provider: "openai", model: config.transcriptionModel,
      meteringComplete: false, pricedCostMicros: null, pricingVersion: PRICING_VERSION } });
    const transcription = await openAiClient().audio.transcriptions.create(
      {
        file: audio,
        model: config.transcriptionModel,
        language: "de",
        response_format: "json",
      },
      { signal: request.signal },
    );
    const providerUsage = transcription.usage;
    const audioSeconds =
      providerUsage?.type === "duration"
        ? providerUsage.seconds
        : validated.durationSeconds;
    const inputTokens = providerUsage?.type === "tokens" ? providerUsage.input_tokens : 0;
    const outputTokens = providerUsage?.type === "tokens" ? providerUsage.output_tokens : 0;
    const response = { transcript: transcription.text, requestId: claimed.request.id };
    await completeAiRequest(prisma, claimed.request.id, user.id, response);
    await completeAiUsage(prisma, usage.id, {
      model: config.transcriptionModel,
      inputTokens,
      outputTokens,
      audioSeconds,
      estimatedCostMicros: estimateAudioCostMicros(audioSeconds, config),
      durationMs: Date.now() - started,
      status: "SUCCEEDED",
      errorCode: null,
    });
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const aborted = request.signal.aborted || isAbort(error);
    const errorCode = aborted
      ? "REQUEST_ABORTED"
      : error instanceof AiCrmError
        ? error.code
        : "INTERNAL_ERROR";
    if (usageId) {
      await completeAiUsage(prisma, usageId, {
        durationMs: Date.now() - started,
        status: aborted ? "ABORTED" : "FAILED",
        errorCode,
      }).catch(() => undefined);
    }
    if (aiRequestId && userId) {
      await failAiRequest(
        prisma,
        aiRequestId,
        userId,
        errorCode,
        aborted ? "ABORTED" : "FAILED",
      ).catch(() => undefined);
    }
    return aiErrorResponse(error, aiRequestId ?? undefined);
  }
}
