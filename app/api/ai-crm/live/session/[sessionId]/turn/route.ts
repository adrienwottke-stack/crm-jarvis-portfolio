import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { claimAiUsage, completeAiUsage, requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { AiCrmError, safeAiMessage } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { musicProviderForLive } from "@/lib/ai-crm/live-music";
import {
  prepareLiveTurnConversation,
  requireLiveSession,
} from "@/lib/ai-crm/live-sessions";
import { runLocalLiveTurn } from "@/lib/ai-crm/live-turn";
import { actionReceipts, cancelActionPlans, resolveAssistantContext } from "@/lib/ai-crm/action-plans";
import { persistConversationExchange } from "@/lib/ai-crm/conversations";
import { requestView } from "@/lib/ai-crm/presentation";
import { assembleAgentContext } from "@/lib/ai-crm/context";
import { claimAiRequest, failAiRequest, hashAiRequestInput } from "@/lib/ai-crm/requests";
import { runUxCrmAgent } from "@/lib/ai-crm/ux-agent";
import { openAiClient } from "@/lib/ai-crm/openai";
import { sendProviderUpdate } from "@/lib/ai-crm/live-provider";
import { classifyOpenAiProviderError } from "@/lib/ai-crm/openai-errors";
import type { AssistantContext, ReadResult } from "@/lib/ai-crm/contracts";
import { assistantContextSchema } from "@/lib/ai-crm/context-schema";
import { withinAiDeadline } from "@/lib/ai-crm/deadline";
import { LIVE_STREAM_TYPE, liveTurnStream, type LiveProgress } from "@/lib/ai-crm/live-progress";
import { startLiveBackchannel } from "@/lib/ai-crm/live-backchannel";
import { renderMeteredSpeechFallback } from "@/lib/ai-crm/speech-fallback";
import { bindWorkRequest, bindWorkUsage, validateAiWorkTask } from "@/lib/workflows/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ sessionId: string }> };
const bodySchema = z
  .object({
    clientTurnId: z.uuid(),
    transcript: z.string().trim().min(1).max(4000),
    delegationId: z.string().min(1).max(120).optional(),
    revision: z.number().int().min(1).max(1_000_000).optional(),
    context: assistantContextSchema.optional(),
    workTaskId: z.string().min(1).max(120).optional(),
  })
  .strict();

export async function POST(request: Request, context: RouteContext) {
  if (request.headers.get("accept")?.includes(LIVE_STREAM_TYPE)) return liveTurnStream(progress => runTurn(request, context, progress));
  return runTurn(request, context);
}

async function runTurn(request: Request, context: RouteContext, progress: (phase: LiveProgress) => void = () => undefined) {
  const startedAt = Date.now();
  let aiRequestId: string | null = null;
  let userId: string | null = null;
  let usageId: string | null = null;
  let stopProgress = () => undefined as void;
  let failureSpeech: ((message: string) => Promise<void>) | undefined;
  try {
    if (!sameOrigin(request)) {
      throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    }
    const user = await requireUser();
    userId = user.id;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AiCrmError(
        "INVALID_REQUEST",
        "Die Live-Zeile ist leer, zu lang oder unvollständig.",
        400,
      );
    }
    const { sessionId: routeSessionId } = await context.params;
    const config = aiCrmConfig();
    await requireAiEntitlement(prisma, user.id, new Date(), config);
    if (config.liveProvider !== "mock" && config.liveProvider !== "live") {
      throw new AiCrmError(
        "LIVE_TRANSPORT_UNAVAILABLE",
        "Die Live-Verbindung ist gerade nicht verfügbar.",
        503,
      );
    }
    const now = new Date();
    // Claim first so a lost response can replay its already-completed result
    // without allocating an empty successor conversation at the 20-message
    // boundary. A valid owner session is still required before that lookup.
    const currentSession = await requireLiveSession(prisma, {
      userId: user.id,
      sessionId: routeSessionId,
      now,
    });
    const sessionUsage = currentSession.usageId ? await prisma.aiUsage.findUnique({ where: { id: currentSession.usageId, userId: user.id }, select: { workTaskId: true } }) : null;
    if (parsed.data.workTaskId && sessionUsage?.workTaskId !== parsed.data.workTaskId) throw new AiCrmError("WORK_LIVE_SESSION_BOUND", "Starte für diese Arbeit eine neue Sprachrunde, damit Sprachkosten eindeutig bleiben.", 409);
    const workTaskId = parsed.data.workTaskId ?? sessionUsage?.workTaskId;
    const workTask = workTaskId ? await validateAiWorkTask(prisma, user.id, workTaskId, parsed.data.context?.contactId) : null;
    if (workTask && parsed.data.context?.partnerId) throw new AiCrmError("WORK_CONTEXT_CHANGED", "Diese Arbeit bezieht sich auf den ausgewählten eigenen Kontakt.", 409);
    const selectedContext = parsed.data.context ?? (workTask ? { contactId: workTask.contactId } : undefined);
    const claimed = await claimAiRequest(prisma, {
      userId: user.id,
      clientRequestId: parsed.data.clientTurnId,
      kind: "LIVE_TURN",
      inputHash: hashAiRequestInput({
        sessionId: routeSessionId,
        ...parsed.data,
      }),
      now,
      expiresAt: currentSession.conversation!.expiresAt,
      staleAfterMs: config.providerTimeoutMs + 15_000,
    });
    if (claimed.kind === "REPLAY") {
      if (workTask) await bindWorkRequest(prisma, user.id, workTask.id, claimed.request.id, "LIVE_TURN", now);
      const current = await requestView(prisma, user.id, claimed.request.id);
      return Response.json({ ...claimed.response, ...current.response, audioDelivered: false }, {
        headers: { "Cache-Control": "no-store", "X-AI-Replayed": "1" },
      });
    }
    if (claimed.kind === "IN_PROGRESS") {
      throw new AiCrmError(
        "REQUEST_IN_PROGRESS",
        "Diese Live-Zeile wird bereits verarbeitet. Bitte warte einen Moment.",
        409,
      );
    }
    aiRequestId = claimed.request.id;
    if (workTask) await bindWorkRequest(prisma, user.id, workTask.id, claimed.request.id, "LIVE_TURN", now);
    const revision = parsed.data.revision ?? currentSession.revision + 1;
    const reserved = await prisma.aiLiveSession.updateMany({ where: { id: routeSessionId, userId: user.id, activeKey: user.id, revision: { lt: revision }, turnCount: { lt: config.liveMaxTurns } }, data: { revision, turnCount: { increment: 1 }, lastHeartbeatAt: now } });
    if (!reserved.count) throw new AiCrmError(currentSession.turnCount >= config.liveMaxTurns ? "LIVE_TURN_LIMIT" : "LIVE_REVISION_STALE", currentSession.turnCount >= config.liveMaxTurns ? "Diese Sprachrunde hat ihr Anfragelimit erreicht. Bitte beende sie." : "Die Anfrage wurde durch einen neueren Auftrag ersetzt.", 409);
    const speakIfCurrent = async (content: string, signal: AbortSignal) => {
      if (!currentSession.providerSessionRef || signal.aborted) return;
      const fresh = await prisma.aiLiveSession.findFirst({ where: { id: routeSessionId, userId: user.id, revision, activeKey: user.id } });
      if (fresh && !signal.aborted) await sendProviderUpdate(currentSession.providerSessionRef, content, { delegationId: parsed.data.delegationId, signal, timeoutMs: 6_000 });
    };
    progress("accepted");
    const backchannel = startLiveBackchannel({
      signal: request.signal, variation: currentSession.turnCount,
      speak: speakIfCurrent, onSlow: () => progress("slow"), onFailure: () => progress("voiceUnavailable"),
    });
    stopProgress = backchannel.stop;
    failureSpeech = message => speakIfCurrent(`Die Bearbeitung der Nutzerfrage ist beendet: ${message} Es gibt noch keine vollständige Antwort.`, request.signal);
    // Reserve both final-message slots only for a new turn. If the existing
    // short-term conversation just reached its boundary, the active Live
    // session is rebound to a fresh one instead of being ended.
    const prepared = await prepareLiveTurnConversation(prisma, {
      userId: user.id,
      sessionId: routeSessionId,
      now,
      retentionDays: config.conversationRetentionDays,
      maxMessages: config.conversationMaxMessages,
    });
    const conversation = prepared.conversation;
    {
      const updated = await prisma.aiRequest.updateMany({
        where: { id: claimed.request.id, userId: user.id, status: "IN_PROGRESS" },
        data: { conversationId: conversation.id, expiresAt: conversation.expiresAt },
      });
      if (updated.count !== 1) {
        throw new AiCrmError(
          "REQUEST_STATE_CHANGED",
          "Die Live-Zeile konnte nicht sicher vorbereitet werden.",
          409,
        );
      }
    }
    let results: ReadResult[] = [];
    let scopeFingerprint: string | undefined;
    let resolvedContext: AssistantContext | undefined;
    let result: { answer: string; actions: Array<{ link?: string }>; music: Awaited<ReturnType<ReturnType<typeof musicProviderForLive>["state"]>> };
    if (currentSession.provider === "live") {
      const attachment = selectedContext ? await resolveAssistantContext(prisma, user.id, selectedContext) : null;
      const history = await assembleAgentContext({ db: prisma, userId: user.id, conversationId: conversation.id, now, context: attachment?.attachment });
      const usage = await claimAiUsage(prisma, user.id, "CHAT", now, config, claimed.request.id);
      usageId = usage.id;
      if (workTask) await bindWorkUsage(prisma, user.id, workTask.id, usage.id);
      const agent = await withinAiDeadline(signal => runUxCrmAgent({ client: openAiClient(), db: prisma, userId: user.id, usageId: usage.id, requestId: claimed.request.id, sessionId: conversation.id, message: parsed.data.transcript, history: history.messages, preparedContext: history, context: attachment?.attachment, now, signal, onProgress: phase => { if (!signal.aborted) { progress(phase); backchannel.advance(phase); } } }), Math.min(config.providerTimeoutMs, 40_000), request.signal);
      results = agent.results;
      scopeFingerprint = agent.scopeFingerprint;
      resolvedContext = agent.context;
      result = { ...agent, music: await musicProviderForLive(prisma).state({ userId: user.id, sessionId: routeSessionId }) };
      await completeAiUsage(prisma, usage.id, { model: config.model, inputTokens: agent.usage.inputTokens, outputTokens: agent.usage.outputTokens, estimatedCostMicros: agent.usage.estimatedCostMicros, durationMs: Date.now() - startedAt, status: "SUCCEEDED", errorCode: null });
    } else result = await runLocalLiveTurn({
      db: prisma,
      userId: user.id,
      sessionId: routeSessionId,
      aiRequestId: claimed.request.id,
      requestId: claimed.request.id,
      transcript: parsed.data.transcript,
      now,
      music: musicProviderForLive(prisma),
    });
    stopProgress();
    request.signal.throwIfAborted();
    const fresh = await requireLiveSession(prisma, { userId: user.id, sessionId: routeSessionId });
    if (fresh.revision !== revision) {
      await cancelActionPlans(prisma, user.id, claimed.request.id);
      await failAiRequest(prisma, claimed.request.id, user.id, "LIVE_REVISION_STALE", "ABORTED");
      return Response.json({ stale: true, revision, actions: [], results: [], requestId: claimed.request.id }, { headers: { "Cache-Control": "no-store" } });
    }
    const actions = await actionReceipts(prisma, user.id, claimed.request.id);
    const messageCount = await prisma.aiConversationMessage.count({
      where: { conversationId: conversation.id },
    });
    const response: {
      mode: "live" | "simulation";
      revision: number;
      results: ReadResult[];
      scopeFingerprint: string | undefined;
      context: AssistantContext | undefined;
      audioDelivered: boolean;
      requestId: string;
      answer: string;
      actions: typeof actions;
      music: typeof result.music;
      conversation: { executionMode?: import("@/lib/ai-crm/contracts").AiExecutionMode; executionVersion?: number; id: string; title: string; expiresAt: string; updatedAt: string; messageCount: number; restarted: boolean; restartReason: "expired" | "limit" | null };
      fallbackAudio?: string;
    } = {
      mode: currentSession.provider === "live" ? "live" as const : "simulation" as const,
      revision,
      results,
      scopeFingerprint,
      context: resolvedContext,
      audioDelivered: false,
      requestId: claimed.request.id,
      answer: result.answer,
      actions,
      music: result.music,
      conversation: {
        id: conversation.id, executionMode: conversation.executionMode, executionVersion: conversation.executionVersion,
        title: conversation.title,
        expiresAt: conversation.expiresAt.toISOString(),
        updatedAt: now.toISOString(),
        messageCount: messageCount + 2,
        restarted: prepared.restarted,
        restartReason: prepared.restartReason,
      },
    };
    await persistConversationExchange(prisma, {
      userId: user.id,
      conversationId: conversation.id,
      userMessage: parsed.data.transcript,
      source: "LIVE",
      assistantMessage: result.answer,
      actions,
      presentation: { requestId: claimed.request.id, results, scopeFingerprint, context: resolvedContext, kind: currentSession.provider === "live" ? "live-result" : undefined },
      now,
      completeRequest: { id: claimed.request.id, response },
    });
    // Only persisted, still-current results may reach provider audio. Browser
    // arguments cannot supply the content, instructions, or target session.
    if (currentSession.providerSessionRef) {
      const audioCurrent = await prisma.aiLiveSession.findFirst({ where: { id: routeSessionId, userId: user.id, revision, activeKey: user.id } });
      if (audioCurrent) {
        progress("speaking");
        try { await sendProviderUpdate(currentSession.providerSessionRef, result.answer, { delegationId: parsed.data.delegationId, signal: request.signal }); response.audioDelivered = true; }
        catch {
          // The durable result is already committed. Do not rerun its CRM work.
          try {
            const audio = await renderMeteredSpeechFallback({ db: prisma, userId: user.id, sessionUsageId: currentSession.usageId, requestId: claimed.request.id, content: result.answer, config });
            const stillCurrent = await prisma.aiLiveSession.findFirst({ where: { id: routeSessionId, userId: user.id, revision, activeKey: user.id }, select: { id: true } });
            if (stillCurrent && audio.byteLength <= 500_000) response.fallbackAudio = Buffer.from(audio).toString("base64");
          }
          catch { progress("voiceUnavailable"); }
        }
      }
    }
    if (result.actions.length > 0) {
      revalidatePath("/heute");
      revalidatePath("/namen");
      revalidatePath("/trichter");
      for (const action of result.actions) {
        if (action.link?.startsWith("/contacts/")) revalidatePath(action.link);
      }
    }
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    stopProgress();
    const normalized = classifyOpenAiProviderError(error) ?? error;
    const errorCode = normalized instanceof AiCrmError ? normalized.code : "INTERNAL_ERROR";
    if (aiRequestId && userId) {
      await failAiRequest(prisma, aiRequestId, userId, errorCode, "FAILED").catch(
        () => undefined,
      );
      await cancelActionPlans(prisma, userId, aiRequestId).catch(() => undefined);
    }
    if (usageId && userId) await prisma.aiUsage.updateMany({ where: { id: usageId, userId, status: "STARTED" }, data: { status: "FAILED", errorCode, durationMs: Date.now() - startedAt } }).catch(() => undefined);
    if (!request.signal.aborted) await failureSpeech?.(safeAiMessage(normalized)).catch(() => undefined);
    return aiErrorResponse(normalized, aiRequestId ?? undefined);
  } finally { stopProgress(); }
}
