import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import {
  claimAiUsage,
  completeAiUsage,
  requireAiEntitlement,
} from "@/lib/ai-crm/entitlement";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { openAiClient } from "@/lib/ai-crm/openai";
import { classifyOpenAiProviderError } from "@/lib/ai-crm/openai-errors";
import { runUxCrmAgent } from "@/lib/ai-crm/ux-agent";
import { resolveAssistantContext } from "@/lib/ai-crm/action-plans";
import { assistantContextSchema } from "@/lib/ai-crm/context-schema";
import { bindWorkRequest, bindWorkUsage, validateAiWorkTask } from "@/lib/workflows/service";
import { requestView } from "@/lib/ai-crm/presentation";
import { assembleAgentContext } from "@/lib/ai-crm/context";
import {
  persistConversationExchange,
} from "@/lib/ai-crm/conversations";
import { beginChatConversation } from "@/lib/ai-crm/chat-conversation";
import {
  claimAiRequest,
  failAiRequest,
  hashAiRequestInput,
} from "@/lib/ai-crm/requests";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    source: z.enum(["text", "voice"]),
    conversationId: z.string().trim().min(8).max(120).optional(),
    clientRequestId: z.uuid(),
    context: assistantContextSchema.optional(),
    workTaskId: z.string().min(1).max(120).optional(),
  })
  .strict();

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
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AiCrmError(
        "INVALID_REQUEST",
        "Die Nachricht ist leer, zu lang oder unvollständig.",
        400,
      );
    }
    const now = new Date();
    const workTask = parsed.data.workTaskId ? await validateAiWorkTask(prisma, user.id, parsed.data.workTaskId, parsed.data.context?.contactId) : null;
    if (workTask && parsed.data.context?.partnerId) throw new AiCrmError("WORK_CONTEXT_CHANGED", "Diese Arbeit bezieht sich auf den ausgewählten eigenen Kontakt.", 409);
    const selectedContext = parsed.data.context ?? (workTask ? { contactId: workTask.contactId } : undefined);
    const attachment = selectedContext ? await resolveAssistantContext(prisma, user.id, selectedContext) : null;
    const claimed = await claimAiRequest(prisma, {
      userId: user.id,
      clientRequestId: parsed.data.clientRequestId,
      kind: "CHAT",
      inputHash: hashAiRequestInput(parsed.data),
      now,
      expiresAt: new Date(
        now.getTime() +
          config.conversationRetentionDays * 24 * 60 * 60 * 1000,
      ),
      staleAfterMs: config.providerTimeoutMs + 15_000,
    });
    if (claimed.kind === "REPLAY") {
      if (workTask) await bindWorkRequest(prisma, user.id, workTask.id, claimed.request.id, "CHAT", now);
      const latest = await requestView(prisma, user.id, claimed.request.id);
      return Response.json(latest.response ?? claimed.response, {
        headers: { "Cache-Control": "no-store", "X-AI-Replayed": "1" },
      });
    }
    if (claimed.kind === "IN_PROGRESS") {
      throw new AiCrmError(
        "REQUEST_IN_PROGRESS",
        "Diese Anfrage wird bereits verarbeitet. Bitte warte einen Moment.",
        409,
      );
    }
    aiRequestId = claimed.request.id;
    if (workTask) await bindWorkRequest(prisma, user.id, workTask.id, claimed.request.id, "CHAT", now);

    const resolved = await beginChatConversation(prisma, {
      userId: user.id,
      requestId: claimed.request.id,
      conversationId: parsed.data.conversationId,
      message: parsed.data.message,
      now,
      retentionDays: config.conversationRetentionDays,
      maxMessages: config.conversationMaxMessages,
    });
    const context = await assembleAgentContext({ db: prisma, userId: user.id, conversationId: resolved.conversation.id, now, context: attachment?.attachment });
    const usage = await claimAiUsage(
      prisma,
      user.id,
      "CHAT",
      now,
      config,
      claimed.request.id,
    );
    usageId = usage.id;
    if (workTask) await bindWorkUsage(prisma, user.id, workTask.id, usage.id);
    const result = await runUxCrmAgent({
      client: openAiClient(),
      db: prisma,
      userId: user.id,
      usageId: usage.id,
      requestId: claimed.request.id,
      sessionId: resolved.conversation.id,
      message: parsed.data.message,
      history: context.messages,
      preparedContext: context,
      context: attachment?.attachment,
      now,
      signal: request.signal,
    });
    const response = {
      ...result,
      requestId: claimed.request.id,
      conversation: {
        id: resolved.conversation.id,
        executionMode: resolved.conversation.executionMode,
        executionVersion: resolved.conversation.executionVersion,
        title: resolved.conversation.title,
        expiresAt: resolved.conversation.expiresAt.toISOString(),
        restarted: resolved.restarted,
        restartReason: resolved.restartReason,
        messageCount: context.messages.length + 2,
        updatedAt: new Date().toISOString(),
      },
    };
    await persistConversationExchange(prisma, {
      userId: user.id,
      conversationId: resolved.conversation.id,
      userMessage: parsed.data.message,
      source: parsed.data.source === "voice" ? "VOICE" : "TEXT",
      assistantMessage: result.answer,
      actions: result.actions,
      presentation: { requestId: claimed.request.id, results: result.results, scopeFingerprint: result.scopeFingerprint, context: result.context },
      now: new Date(),
      completeRequest: { id: claimed.request.id, response },
    });
    if (result.actions.length > 0) {
      revalidatePath("/heute");
      revalidatePath("/namen");
      revalidatePath("/trichter");
      for (const action of result.actions) {
        if (action.link?.startsWith("/contacts/")) {
          revalidatePath(action.link);
        }
      }
    }
    await completeAiUsage(prisma, usage.id, {
      model: config.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostMicros: result.usage.estimatedCostMicros,
      durationMs: Date.now() - started,
      status: "SUCCEEDED",
      errorCode: null,
    }).catch(() => undefined);
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const normalizedError = classifyOpenAiProviderError(error) ?? error;
    const aborted = request.signal.aborted || isAbort(normalizedError);
    const errorCode = aborted
      ? "REQUEST_ABORTED"
      : normalizedError instanceof AiCrmError
        ? normalizedError.code
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
      const failed = await prisma.aiRequest.findFirst({ where: { id: aiRequestId, userId, status: { in: ["FAILED", "ABORTED"] } }, select: { id: true } }).catch(() => null);
      if (failed) await prisma.aiToolExecution.updateMany({ where: { requestId: failed.id, userId, status: "PENDING" }, data: { status: "CANCELED" } }).catch(() => undefined);
    }
    return aiErrorResponse(normalizedError, aiRequestId ?? undefined);
  }
}
