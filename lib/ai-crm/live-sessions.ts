import type { PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

type LiveProvider = "mock" | "realtime" | "live";

function conversationExpiry(now: Date, retentionDays: number) {
  return new Date(now.getTime() + retentionDays * DAY_MS);
}

function sessionExpiry(now: Date, maxSessionSeconds: number) {
  return new Date(now.getTime() + maxSessionSeconds * 1000);
}

async function createLiveConversation(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  userId: string,
  now: Date,
  retentionDays: number,
) {
  return tx.aiConversation.create({
    data: {
      userId,
      title: `Sprachgespräch · ${new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(now)}`,
      startedAt: now,
      expiresAt: conversationExpiry(now, retentionDays),
      createdAt: now,
    },
  });
}

async function resolveLiveConversation(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  params: {
    userId: string;
    conversationId?: string | null;
    now: Date;
    retentionDays: number;
    maxMessages: number;
  },
) {
  if (!params.conversationId) {
    return {
      conversation: await createLiveConversation(
        tx,
        params.userId,
        params.now,
        params.retentionDays,
      ),
      restarted: false,
      restartReason: null,
    };
  }

  const conversation = await tx.aiConversation.findFirst({
    where: { id: params.conversationId, userId: params.userId },
    include: { _count: { select: { messages: true } } },
  });
  if (!conversation) {
    throw new AiCrmError(
      "CONVERSATION_NOT_FOUND",
      "Diese Unterhaltung wurde nicht gefunden.",
      404,
    );
  }
  // A Live turn is always a visible user/assistant pair. At 19 messages a
  // session could technically start, but its first final turn would exceed
  // the 20-message boundary. Reserve both slots before opening the round.
  if (
    conversation.expiresAt <= params.now ||
    conversation._count.messages > params.maxMessages - 2
  ) {
    return {
      conversation: await createLiveConversation(
        tx,
        params.userId,
        params.now,
        params.retentionDays,
      ),
      restarted: true,
      restartReason: conversation.expiresAt <= params.now ? "expired" as const : "limit" as const,
    };
  }
  return { conversation, restarted: false, restartReason: null };
}

export async function startLiveSession(
  db: PrismaClient,
  params: {
    userId: string;
    provider: LiveProvider;
    clientSessionId: string;
    conversationId?: string | null;
    now?: Date;
    retentionDays: number;
    maxMessages: number;
    maxSessionSeconds: number;
    introEnabled?: boolean;
    usageId?: string | null;
  },
) {
  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    // The owner row lock serializes start/retry requests from multiple tabs.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${params.userId} FOR UPDATE`;
    await tx.aiLiveSession.updateMany({
      where: {
        userId: params.userId,
        activeKey: params.userId,
        expiresAt: { lte: now },
      },
      data: {
        status: "EXPIRED",
        activeKey: null,
        endedAt: now,
        errorCode: "LIVE_SESSION_EXPIRED",
      },
    });
    const active = await tx.aiLiveSession.findFirst({
      where: { userId: params.userId, activeKey: params.userId },
      include: { conversation: true },
    });
    if (active?.conversation && active.conversation.expiresAt > now) {
      // A browser retry may safely recover its own just-created session. A
      // different tab is not allowed to attach to it: otherwise two media
      // streams could issue turns against the same conversation concurrently.
      if (active.clientSessionId === params.clientSessionId) {
        if (active.provider !== params.provider) throw new AiCrmError("LIVE_PROVIDER_CHANGED", "Die Sprachkonfiguration wurde geändert. Beende die alte Runde und starte neu.", 409);
        return {
          session: active,
          conversation: active.conversation,
          reused: true,
          restarted: false,
          restartReason: null,
        };
      }
      throw new AiCrmError(
        "LIVE_SESSION_ALREADY_ACTIVE",
        "Für dich ist noch eine Sprachsitzung geöffnet. Sie kann in einem anderen Tab laufen oder nach einem unterbrochenen Start übrig sein. Du kannst die vorherige Sitzung hier beenden und danach neu starten.",
        409,
      );
    }
    if (active) {
      await tx.aiLiveSession.update({
        where: { id: active.id },
        data: {
          status: "ENDED",
          activeKey: null,
          endedAt: now,
          errorCode: "LIVE_CONVERSATION_UNAVAILABLE",
        },
      });
    }
    const resolved = await resolveLiveConversation(tx, {
      userId: params.userId,
      conversationId: params.conversationId,
      now,
      retentionDays: params.retentionDays,
      maxMessages: params.maxMessages,
    });
    const session = await tx.aiLiveSession.create({
      data: {
        userId: params.userId,
        conversationId: resolved.conversation.id,
        provider: params.provider,
        introState: params.introEnabled ? "WAITING" : "DONE",
        status: "ACTIVE",
        activeKey: params.userId,
        clientSessionId: params.clientSessionId,
        usageId: params.usageId ?? null,
        startedAt: now,
        lastHeartbeatAt: now,
        expiresAt: sessionExpiry(now, params.maxSessionSeconds),
        createdAt: now,
      },
    });
    return {
      session,
      conversation: resolved.conversation,
      reused: false,
      restarted: resolved.restarted,
      restartReason: resolved.restartReason,
    };
  });
}

/**
 * Allocate two durable conversation slots for the next final Live exchange.
 * A continuous round keeps its session and microphone state when its current
 * seven-day conversation expires or reaches 20 messages; only the bounded
 * short-term context changes. The session row lock serializes this handover
 * with concurrent heartbeats and protects its owner boundary.
 */
export async function prepareLiveTurnConversation(
  db: PrismaClient,
  params: {
    userId: string;
    sessionId: string;
    now?: Date;
    retentionDays: number;
    maxMessages: number;
  },
) {
  const now = params.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "AiLiveSession" WHERE "id" = ${params.sessionId} AND "userId" = ${params.userId} FOR UPDATE`;
    const session = await tx.aiLiveSession.findFirst({
      where: { id: params.sessionId, userId: params.userId },
      include: { conversation: { include: { _count: { select: { messages: true } } } } },
    });
    if (!session) {
      throw new AiCrmError(
        "LIVE_SESSION_NOT_FOUND",
        "Diese Live-Session wurde nicht gefunden.",
        404,
      );
    }
    if (session.expiresAt <= now && session.activeKey) {
      await tx.aiLiveSession.update({
        where: { id: session.id },
        data: {
          status: "EXPIRED",
          activeKey: null,
          endedAt: now,
          errorCode: "LIVE_SESSION_EXPIRED",
        },
      });
      throw new AiCrmError(
        "LIVE_SESSION_EXPIRED",
        "Diese Live-Session ist abgelaufen. Bitte starte eine neue.",
        410,
      );
    }
    if (!session.activeKey || session.status !== "ACTIVE") {
      throw new AiCrmError(
        "LIVE_SESSION_ENDED",
        "Diese Live-Session wurde bereits beendet.",
        409,
      );
    }

    const current = session.conversation;
    const needsNewConversation =
      !current ||
      current.expiresAt <= now ||
      current._count.messages > params.maxMessages - 2;
    if (!needsNewConversation) {
      return {
        session,
        conversation: current,
        restarted: false,
        restartReason: null,
      };
    }

    const restartReason =
      !current || current.expiresAt <= now ? "expired" as const : "limit" as const;
    const conversation = await createLiveConversation(
      tx,
      params.userId,
      now,
      params.retentionDays,
    );
    const updatedSession = await tx.aiLiveSession.update({
      where: { id: session.id },
      data: { conversationId: conversation.id, lastHeartbeatAt: now },
    });
    return {
      session: updatedSession,
      conversation,
      restarted: true,
      restartReason,
    };
  });
}

export async function requireLiveSession(
  db: PrismaClient,
  params: { userId: string; sessionId: string; now?: Date },
) {
  const now = params.now ?? new Date();
  const session = await db.aiLiveSession.findFirst({
    where: { id: params.sessionId, userId: params.userId },
    include: { conversation: true },
  });
  if (!session) {
    throw new AiCrmError(
      "LIVE_SESSION_NOT_FOUND",
      "Diese Live-Session wurde nicht gefunden.",
      404,
    );
  }
  if (session.expiresAt <= now && session.activeKey) {
    await db.aiLiveSession.updateMany({
      where: { id: session.id, userId: params.userId, activeKey: params.userId },
      data: {
        status: "EXPIRED",
        activeKey: null,
        endedAt: now,
        errorCode: "LIVE_SESSION_EXPIRED",
      },
    });
    throw new AiCrmError(
      "LIVE_SESSION_EXPIRED",
      "Diese Live-Session ist abgelaufen. Bitte starte eine neue.",
      410,
    );
  }
  if (!session.activeKey || session.status !== "ACTIVE") {
    throw new AiCrmError(
      "LIVE_SESSION_ENDED",
      "Diese Live-Session wurde bereits beendet.",
      409,
    );
  }
  if (!session.conversation || session.conversation.expiresAt <= now) {
    throw new AiCrmError(
      "LIVE_CONVERSATION_UNAVAILABLE",
      "Die zugehörige Unterhaltung ist nicht mehr verfügbar.",
      410,
    );
  }
  return session;
}

export async function heartbeatLiveSession(
  db: PrismaClient,
  params: { userId: string; sessionId: string; now?: Date },
) {
  const now = params.now ?? new Date();
  const session = await requireLiveSession(db, { ...params, now });
  return db.aiLiveSession.update({
    where: { id: session.id },
    data: { lastHeartbeatAt: now },
  });
}

export async function endLiveSession(
  db: PrismaClient,
  params: { userId: string; sessionId: string; now?: Date; errorCode?: string | null },
) {
  const now = params.now ?? new Date();
  const session = await db.aiLiveSession.findFirst({
    where: { id: params.sessionId, userId: params.userId },
  });
  if (!session) {
    throw new AiCrmError(
      "LIVE_SESSION_NOT_FOUND",
      "Diese Live-Session wurde nicht gefunden.",
      404,
    );
  }
  if (!session.activeKey) return session;
  return db.aiLiveSession.update({
    where: { id: session.id },
    data: {
      status: "ENDED",
      activeKey: null,
      endedAt: now,
      errorCode: params.errorCode ?? null,
    },
  });
}
