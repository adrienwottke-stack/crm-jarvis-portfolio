import type { PrismaClient } from "@/lib/generated/prisma/client";
import { conversationHistory } from "@/lib/ai-crm/conversations";
import { actionReceipts, actionPlansAccessible, hydrateUndo } from "@/lib/ai-crm/action-plans";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { leadershipScopeFingerprint } from "@/lib/ai-crm/leadership-scope";
import { resolveAssistantContext } from "@/lib/ai-crm/action-plans";
import type { ActionReceipt, Entry, ReadResult } from "@/lib/ai-crm/contracts";
import { answerWithReceipts } from "@/lib/ai-crm/receipt-answer";

async function resultsAccessible(db: PrismaClient, userId: string, results?: ReadResult[]) {
  for (const result of results ?? []) for (const item of result.items ?? []) {
    if (!item.context) continue;
    try { await resolveAssistantContext(db, userId, item.context); } catch { return false; }
  }
  return true;
}

export async function conversationView(db: PrismaClient, userId: string, id: string, now = new Date()) {
  const conversation = await conversationHistory(db, userId, id, now);
  const scopeFingerprint = await leadershipScopeFingerprint(db, userId);
  const messages: Entry[] = await Promise.all(conversation.messages.map(async (message, index) => {
    const envelope = message.actions as unknown as { requestId?: string; actions?: ActionReceipt[]; results?: ReadResult[]; scopeFingerprint?: string; kind?: string } | null;
    if (envelope?.scopeFingerprint && envelope.scopeFingerprint !== scopeFingerprint || !await resultsAccessible(db, userId, envelope?.results) || envelope?.requestId && !await actionPlansAccessible(db, userId, envelope.requestId)) return { id: message.id, role: "assistant", content: "Die damalige Antwort ist wegen eines geänderten Zugriffsbereichs nicht mehr verfügbar. Bitte frage mit dem aktuellen Stand erneut.", createdAt: message.createdAt.toISOString() };
    const saved = Array.isArray(message.actions) ? message.actions as unknown as ActionReceipt[] : envelope?.actions ?? [];
    const actions = envelope?.requestId ? await actionReceipts(db, userId, envelope.requestId) : await hydrateUndo(db, userId, saved);
    return { id: message.id, role: message.role === "user" ? "user" : "assistant", content: message.role === "assistant" ? answerWithReceipts(message.content, actions) : message.content,
      kind: message.role === "assistant" && (envelope?.kind === "live-result" || conversation.messages[index - 1]?.source === "LIVE") ? "live-result" : undefined,
      source: message.source === "VOICE" ? "voice" : message.source === "TEXT" ? "text" : message.source === "LIVE" ? "live" : undefined,
      createdAt: message.createdAt.toISOString(), actions, results: envelope?.results, requestId: envelope?.requestId };
  }));
  const lastEnvelope = conversation.messages.findLast(message => message.role === "assistant")?.actions as unknown as { context?: import("@/lib/ai-crm/contracts").AssistantContext; scopeFingerprint?: string } | undefined;
  const context = lastEnvelope?.context && (!lastEnvelope.scopeFingerprint || lastEnvelope.scopeFingerprint === scopeFingerprint) ? await resolveAssistantContext(db, userId, lastEnvelope.context).then(value => value.attachment).catch(() => undefined) : undefined;
  return { ...conversation, messages, context, messageCount: messages.length };
}

export async function requestView(db: PrismaClient, userId: string, clientRequestId: string) {
  const request = await db.aiRequest.findFirst({ where: { userId, OR: [{ id: clientRequestId }, { clientRequestId }], kind: { in: ["CHAT", "LIVE_TURN"] }, expiresAt: { gt: new Date() }, status: { not: "TOMBSTONED" } } });
  if (!request) throw new AiCrmError("REQUEST_NOT_FOUND", "Diese Anfrage ist noch nicht verfügbar oder bereits abgelaufen.", 404);
  const actions = await actionReceipts(db, userId, request.id);
  const response = request.response && typeof request.response === "object" ? request.response as Record<string, unknown> : null;
  if (!await actionPlansAccessible(db, userId, request.id) || response && (response.scopeFingerprint && response.scopeFingerprint !== await leadershipScopeFingerprint(db, userId) || !await resultsAccessible(db, userId, response.results as ReadResult[] | undefined))) return { id: request.id, status: request.status, errorCode: "LEADERSHIP_SCOPE_CHANGED", actions: [], response: response ? { ...response, answer: "Der Zugriffsbereich hat sich geändert. Bitte frage erneut.", actions: [], results: [], context: undefined } : null, conversationId: request.conversationId };
  return { id: request.id, status: request.status, errorCode: request.errorCode, actions, response: response ? { ...response, ...(typeof response.answer === "string" ? { answer: answerWithReceipts(response.answer, actions) } : {}), actions } : null, conversationId: request.conversationId };
}
