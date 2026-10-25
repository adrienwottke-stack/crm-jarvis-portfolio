import type { PrismaClient } from "@/lib/generated/prisma/client";
import { resolveConversation } from "@/lib/ai-crm/conversations";
import { AiCrmError } from "@/lib/ai-crm/errors";

/** Bind an exchange under an owner lock so two devices cannot both append
 * to the same 18-message context or delete it while it is being attached. */
export async function beginChatConversation(db: PrismaClient, params: {
  userId: string; requestId: string; conversationId?: string; message: string;
  now: Date; retentionDays: number; maxMessages: number;
}) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${params.userId} FOR UPDATE`;
    if (params.conversationId) {
      await tx.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${params.conversationId} AND "userId" = ${params.userId} FOR UPDATE`;
      const other = await tx.aiRequest.findFirst({ where: { userId: params.userId, conversationId: params.conversationId, id: { not: params.requestId }, status: "IN_PROGRESS", expiresAt: { gt: params.now } } });
      if (other) throw new AiCrmError("CONVERSATION_BUSY", "In dieser Unterhaltung läuft bereits eine Anfrage. Bitte warte auf das Ergebnis.", 409);
    }
    // resolveConversation uses only model delegates, no nested transaction.
    const resolved = await resolveConversation(tx as PrismaClient, params);
    await tx.aiRequest.update({ where: { id: params.requestId, userId: params.userId }, data: { conversationId: resolved.conversation.id, expiresAt: resolved.conversation.expiresAt } });
    return resolved;
  });
}
