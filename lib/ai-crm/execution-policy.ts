import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";
import type { AiExecutionMode } from "@/lib/ai-crm/contracts";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";

type Db = PrismaClient | Prisma.TransactionClient;
const rank: Record<AiExecutionMode, number> = { READ_ONLY: 0, CONFIRM: 1, AUTONOMOUS: 2 };
export const executionModesEnabled = () => process.env.AI_CRM_EXECUTION_MODES === "true";
export function stricterMode(a: AiExecutionMode, b: AiExecutionMode): AiExecutionMode { return rank[a] < rank[b] ? a : b; }

export async function lockConversationPolicy(db: Db, userId: string, conversationId: string) {
  await db.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${conversationId} AND "userId" = ${userId} FOR UPDATE`;
  const conversation = await db.aiConversation.findFirst({ where: { id: conversationId, userId, expiresAt: { gt: new Date() } } });
  if (!conversation) throw new AiCrmError("CONVERSATION_NOT_FOUND", "Dieser Chat ist nicht mehr verfügbar.", 404);
  return conversation;
}

/** Captured once under the same conversation lock used by mode changes and commits. */
export async function captureExecutionPolicy(db: PrismaClient, userId: string, requestId: string, conversationId: string) {
  return db.$transaction(async tx => {
    const conversation = await lockConversationPolicy(tx, userId, conversationId);
    const request = await tx.aiRequest.findFirst({ where: { id: requestId, userId, conversationId, status: "IN_PROGRESS" } });
    if (!request) throw new AiCrmError("REQUEST_ABORTED", "Der Auftrag wurde beendet.", 409);
    const mode = request.executionMode ?? (executionModesEnabled() ? conversation.executionMode : "CONFIRM");
    if (!request.executionMode) await tx.aiRequest.update({ where: { id: request.id }, data: { executionMode: mode } });
    return stricterMode(mode, conversation.executionMode);
  });
}

export async function assertExecutionAllowed(db: Db, userId: string, requestId: string, direct: boolean) {
  const request = await db.aiRequest.findFirst({ where: { id: requestId, userId } });
  if (!request?.conversationId) throw new AiCrmError("PLAN_UNAVAILABLE", "Der Auftrag gehört zu keinem verfügbaren Chat.", 409);
  const conversation = await lockConversationPolicy(db, userId, request.conversationId);
  const mode = stricterMode(request.executionMode ?? "CONFIRM", conversation.executionMode);
  if (mode === "READ_ONLY") throw new AiCrmError("READ_ONLY", "Dieser Chat darf nur lesen. Ändere bei Bedarf unten links die Zugriffe und erteile den Auftrag erneut.", 403);
  if (direct && (!executionModesEnabled() || mode !== "AUTONOMOUS")) throw new AiCrmError("CONFIRMATION_REQUIRED", "Bitte prüfe und bestätige die vorbereitete Änderung.", 409);
  const actor = await db.user.findFirst({ where: { id: userId, deactivatedAt: null }, select: { id: true } });
  if (!actor) throw new AiCrmError("FORBIDDEN", "Dieses Konto ist nicht mehr aktiv.", 403);
  // The entitlement check only reads delegates, which also exist on TransactionClient.
  if (request.executionMode) await requireAiEntitlement(db as PrismaClient, userId);
  return mode;
}

export async function setExecutionMode(db: PrismaClient, params: { userId: string; conversationId: string; mode: AiExecutionMode; version: number }) {
  if (!executionModesEnabled()) throw new AiCrmError("EXECUTION_MODES_DISABLED", "Die Zugriffsauswahl ist hier noch nicht aktiviert.", 403);
  return db.$transaction(async tx => {
    const current = await lockConversationPolicy(tx, params.userId, params.conversationId);
    if (current.executionVersion !== params.version) throw new AiCrmError("POLICY_STALE", "Die Zugriffe wurden inzwischen geändert. Bitte lade den Chat erneut.", 409);
    const conversation = await tx.aiConversation.update({ where: { id: current.id }, data: { executionMode: params.mode, executionVersion: { increment: 1 } } });
    await tx.aiAuditEvent.create({ data: { userId: params.userId, requestId: `policy:${current.id}:${conversation.executionVersion}`, sessionId: current.id, action: "EXECUTION_MODE_CHANGED", entityType: "AiConversation", entityId: current.id, success: true, before: { mode: current.executionMode }, after: { mode: params.mode } } });
    return conversation;
  });
}
