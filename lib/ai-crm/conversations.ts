import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

function titleFrom(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length <= 60 ? compact : `${compact.slice(0, 57).trimEnd()}…`;
}

function expiry(now: Date, retentionDays: number) {
  return new Date(now.getTime() + retentionDays * DAY_MS);
}

async function createConversation(
  db: PrismaClient,
  params: { userId: string; message: string; now: Date; retentionDays: number },
) {
  return db.aiConversation.create({
    data: {
      userId: params.userId,
      title: titleFrom(params.message),
      startedAt: params.now,
      expiresAt: expiry(params.now, params.retentionDays),
      createdAt: params.now,
    },
  });
}

export async function resolveConversation(
  db: PrismaClient,
  params: {
    userId: string;
    conversationId?: string | null;
    message: string;
    now?: Date;
    retentionDays: number;
    maxMessages: number;
  },
) {
  const now = params.now ?? new Date();
  if (!params.conversationId) {
    return {
      conversation: await createConversation(db, { ...params, now }),
      restarted: false,
      restartReason: null,
    };
  }

  const current = await db.aiConversation.findFirst({
    where: { id: params.conversationId, userId: params.userId },
    include: { _count: { select: { messages: true } } },
  });
  if (!current) {
    throw new AiCrmError(
      "CONVERSATION_NOT_FOUND",
      "Diese Unterhaltung wurde nicht gefunden.",
      404,
    );
  }
  if (current.expiresAt <= now || current._count.messages >= params.maxMessages) {
    return {
      conversation: await createConversation(db, { ...params, now }),
      restarted: true,
      restartReason: current.expiresAt <= now ? "expired" : "limit",
    };
  }
  return {
    conversation: {
      id: current.id,
      executionMode: current.executionMode,
      executionVersion: current.executionVersion,
      userId: current.userId,
      title: current.title,
      startedAt: current.startedAt,
      expiresAt: current.expiresAt,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    },
    restarted: false,
    restartReason: null,
  };
}

export async function conversationHistory(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  now = new Date(),
) {
  const conversation = await db.aiConversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 20,
      },
    },
  });
  if (!conversation) {
    throw new AiCrmError(
      "CONVERSATION_NOT_FOUND",
      "Diese Unterhaltung wurde nicht gefunden.",
      404,
    );
  }
  if (conversation.expiresAt <= now) {
    throw new AiCrmError(
      "CONVERSATION_EXPIRED",
      "Diese Unterhaltung ist nach sieben Tagen abgelaufen.",
      410,
    );
  }
  return conversation;
}

export async function persistConversationExchange(
  db: PrismaClient,
  params: {
    userId: string;
    conversationId: string;
    userMessage: string;
    source: "TEXT" | "VOICE" | "LIVE";
    assistantMessage: string;
    actions: unknown[];
    presentation?: { requestId: string; results: unknown[]; scopeFingerprint?: string; context?: unknown; kind?: "live-result" };
    now?: Date;
    completeRequest?: {
      id: string;
      response: Record<string, unknown>;
    };
  },
) {
  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    // Serialize persisting an exchange and deleting the conversation.
    await tx.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${params.conversationId} AND "userId" = ${params.userId} FOR UPDATE`;
    const conversation = await tx.aiConversation.findFirst({
      where: {
        id: params.conversationId,
        userId: params.userId,
        expiresAt: { gt: now },
      },
      include: { _count: { select: { messages: true } } },
    });
    if (!conversation) {
      throw new AiCrmError(
        "CONVERSATION_EXPIRED",
        "Diese Unterhaltung ist nach sieben Tagen abgelaufen.",
        410,
      );
    }
    if (conversation._count.messages > 18) {
      throw new AiCrmError(
        "CONVERSATION_FULL",
        "Diese Unterhaltung ist vollständig. Bitte beginne eine neue.",
        409,
      );
    }
    await tx.aiConversationMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          role: "user",
          source: params.source,
          content: params.userMessage,
          createdAt: now,
        },
        {
          conversationId: conversation.id,
          role: "assistant",
          content: params.assistantMessage,
          actions: JSON.parse(JSON.stringify(params.presentation ? { ...params.presentation, actions: params.actions } : params.actions)),
          createdAt: new Date(now.getTime() + 1),
        },
      ],
    });
    const updated = await tx.aiConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: now, ...(params.source === "LIVE" && conversation._count.messages === 0 && /^(?:Live mit Jarvis|Sprachgespräch ·)/.test(conversation.title) && params.presentation?.kind === "live-result" ? { title: titleFrom(params.userMessage) } : {}) },
    });
    if (params.completeRequest) {
      const completed = await tx.aiRequest.updateMany({
        where: {
          id: params.completeRequest.id,
          userId: params.userId,
          status: "IN_PROGRESS",
        },
        data: {
          conversationId: conversation.id,
          status: "COMPLETED",
          response: JSON.parse(
            JSON.stringify(params.completeRequest.response),
          ) as Prisma.InputJsonValue,
          finishedAt: now,
          errorCode: null,
        },
      });
      if (completed.count !== 1) {
        throw new AiCrmError(
          "REQUEST_STATE_CHANGED",
          "Die Anfrage konnte nicht sicher abgeschlossen werden.",
          409,
        );
      }
    }
    return updated;
  });
}

export async function listConversations(
  db: PrismaClient,
  userId: string,
  now = new Date(),
  cursor?: string,
) {
  return db.aiConversation.findMany({
    where: { userId, expiresAt: { gt: now } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 10,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      startedAt: true,
      expiresAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });
}

export async function deleteConversation(
  db: PrismaClient,
  userId: string,
  conversationId: string,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AiConversation" WHERE "id" = ${conversationId} AND "userId" = ${userId} FOR UPDATE`;
    const conversation = await tx.aiConversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true, expiresAt: true },
    });
    if (!conversation) {
      throw new AiCrmError(
        "CONVERSATION_NOT_FOUND",
        "Diese Unterhaltung wurde nicht gefunden.",
        404,
      );
    }
    const requests = await tx.aiRequest.findMany({
      where: { userId, conversationId },
      select: { id: true, status: true },
    });
    if (conversation.expiresAt > now && requests.some(request => request.status === "IN_PROGRESS")) {
      throw new AiCrmError("CONVERSATION_BUSY", "Bitte beende zuerst die laufende Anfrage und prüfe ihr Ergebnis.", 409);
    }
    if (requests.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AiRequest" WHERE "id" IN (${Prisma.join(requests.map(item => item.id))}) ORDER BY "id" FOR UPDATE`);
    const requestIds = requests.map((request) => request.id);
    if (requestIds.length > 0) {
      await tx.aiToolExecution.updateMany({
        where: { userId, requestId: { in: requestIds } },
        data: { result: Prisma.DbNull },
      });
      await tx.aiRequest.updateMany({
        where: { userId, id: { in: requestIds } },
        data: {
          conversationId: null,
          response: Prisma.DbNull,
          status: "TOMBSTONED",
        },
      });
    }
    // A deleted conversation can no longer be the context of an open live
    // round. Session metadata remains only until its ordinary retention; its
    // foreign key is nulled by the delete below and cannot expose messages.
    await tx.aiLiveSession.updateMany({
      where: { userId, conversationId, activeKey: { not: null } },
      data: {
        status: "ENDED",
        activeKey: null,
        endedAt: new Date(),
        errorCode: "CONVERSATION_DELETED",
      },
    });
    await tx.aiConversation.delete({ where: { id: conversationId } });
    return true;
  });
}

export async function cleanupExpiredAiContent(
  db: PrismaClient,
  now = new Date(),
) {
  const expired = await db.aiConversation.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true, userId: true },
    take: 500,
  });
  let conversations = 0;
  for (const item of expired) {
    await deleteConversation(db, item.userId, item.id, now);
    conversations += 1;
  }
  const requests = await db.aiRequest.deleteMany({
    where: { expiresAt: { lte: now }, conversationId: null },
  });
  return { conversations, requests: requests.count };
}
