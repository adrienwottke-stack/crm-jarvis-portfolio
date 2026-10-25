import type { PrismaClient } from "@/lib/generated/prisma/client";
import { berlinDayOf, berlinLocalToUtc } from "@/lib/dates";
import { aiCrmConfig, type AiCrmConfig } from "@/lib/ai-crm/config";
import { AiCrmError } from "@/lib/ai-crm/errors";

type Db = Pick<
  PrismaClient,
  "user" | "feature" | "aiSubscription" | "aiUsage" | "$transaction"
>;

export type EntitlementConfig = Pick<
  AiCrmConfig,
  | "globallyEnabled"
  | "monthlyRequestLimit"
  | "monthlyAudioSecondsLimit"
  | "monthlyToolCallLimit"
>;

export type AiEntitlement = {
  allowed: boolean;
  source: "BETA" | "SUBSCRIPTION" | null;
  reason: "GLOBAL_DISABLED" | "FEATURE_DISABLED" | "NO_ENTITLEMENT" | null;
  currentPeriodEnd: Date | null;
};

function paidUntil(
  subscription: { status: string; currentPeriodEnd: Date | null } | null,
  now: Date,
): boolean {
  if (!subscription) return false;
  if (["ACTIVE", "TRIALING"].includes(subscription.status.toUpperCase())) {
    // Ein Stripe-Abo ohne bestaetigtes Periodenende ist kein belastbarer
    // Zahlungsnachweis. Wiederkehrende Prices liefern diesen Wert immer;
    // fehlt er, sperren wir sicherheitshalber statt unbegrenzt freizuschalten.
    return subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd > now;
  }
  return (
    subscription.status.toUpperCase() === "CANCELED" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd > now
  );
}

/** Eine einzige Entitlement-Entscheidung fuer Seite, APIs und Billing-Rueckkehr. */
export async function aiEntitlement(
  db: Db,
  userId: string,
  now = new Date(),
  config: EntitlementConfig = aiCrmConfig(),
): Promise<AiEntitlement> {
  if (!config.globallyEnabled) {
    return {
      allowed: false,
      source: null,
      reason: "GLOBAL_DISABLED",
      currentPeriodEnd: null,
    };
  }

  const [user, feature, subscription] = await Promise.all([
    db.user.findFirst({
      where: { id: userId, deactivatedAt: null },
      select: { aiBetaEnabled: true },
    }),
    db.feature.findUnique({ where: { key: "aiCrm" }, select: { state: true } }),
    db.aiSubscription.findUnique({
      where: { userId },
      select: { status: true, currentPeriodEnd: true },
    }),
  ]);

  if (!user) {
    return { allowed: false, source: null, reason: "NO_ENTITLEMENT", currentPeriodEnd: null };
  }
  if (!feature || ["AUS", "ABGERISSEN"].includes(feature.state)) {
    return { allowed: false, source: null, reason: "FEATURE_DISABLED", currentPeriodEnd: null };
  }
  if (user.aiBetaEnabled) {
    return { allowed: true, source: "BETA", reason: null, currentPeriodEnd: null };
  }
  if (paidUntil(subscription, now)) {
    return {
      allowed: true,
      source: "SUBSCRIPTION",
      reason: null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    };
  }
  return {
    allowed: false,
    source: null,
    reason: "NO_ENTITLEMENT",
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
  };
}

export async function requireAiEntitlement(
  db: Db,
  userId: string,
  now = new Date(),
  config: EntitlementConfig = aiCrmConfig(),
) {
  const entitlement = await aiEntitlement(db, userId, now, config);
  if (!entitlement.allowed) {
    throw new AiCrmError(
      "AI_NOT_ENTITLED",
      "AI CRM ist für dein Konto noch nicht aktiviert.",
      403,
    );
  }
  return entitlement;
}

export function aiUsageMonthWindow(now: Date): { from: Date; to: Date } {
  const day = berlinDayOf(now);
  const fromDay = `${day.slice(0, 7)}-01`;
  const nextMonthAnchor = new Date(`${fromDay}T12:00:00Z`);
  nextMonthAnchor.setUTCMonth(nextMonthAnchor.getUTCMonth() + 1);
  const toDay = berlinDayOf(nextMonthAnchor);
  return {
    from: berlinLocalToUtc(`${fromDay}T00:00`)!,
    to: berlinLocalToUtc(`${toDay}T00:00`)!,
  };
}

/**
 * Reserviert einen Provider-Aufruf unter einer Kontosperre. Dadurch koennen
 * parallele Tabs das Monatslimit nicht beide gleichzeitig ueberschreiten.
 */
export async function claimAiUsage(
  db: Db,
  userId: string,
  kind: "CHAT" | "TRANSCRIPTION" | "LIVE_SESSION" | "SPEECH_FALLBACK",
  now = new Date(),
  config: EntitlementConfig = aiCrmConfig(),
  requestId = crypto.randomUUID(),
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const { from, to } = aiUsageMonthWindow(now);
    const aggregate = await tx.aiUsage.aggregate({
      where: { userId, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { audioSeconds: true, toolCalls: true },
    });
    if (aggregate._count._all >= config.monthlyRequestLimit) {
      throw new AiCrmError(
        "MONTHLY_REQUEST_LIMIT",
        "Du hast dein AI-Nutzungslimit für diesen Monat erreicht.",
        429,
      );
    }
    if ((aggregate._sum.audioSeconds ?? 0) >= config.monthlyAudioSecondsLimit) {
      throw new AiCrmError(
        "MONTHLY_AUDIO_LIMIT",
        "Du hast dein Sprachlimit für diesen Monat erreicht.",
        429,
      );
    }
    if ((aggregate._sum.toolCalls ?? 0) >= config.monthlyToolCallLimit) {
      throw new AiCrmError(
        "MONTHLY_TOOL_LIMIT",
        "Du hast dein AI-Nutzungslimit für diesen Monat erreicht.",
        429,
      );
    }
    return tx.aiUsage.create({
      data: { userId, requestId, kind, createdAt: now },
    });
  });
}

export async function completeAiUsage(
  db: Pick<PrismaClient, "aiUsage">,
  id: string,
  values: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    audioSeconds?: number;
    toolCalls?: number;
    estimatedCostMicros?: number;
    durationMs?: number;
    status?: "STARTED" | "SUCCEEDED" | "FAILED" | "ABORTED";
    errorCode?: string | null;
  },
) {
  return db.aiUsage.update({ where: { id }, data: values });
}

export async function reserveAiToolCall(
  db: Db,
  usageId: string,
  userId: string,
  now = new Date(),
  config: EntitlementConfig = aiCrmConfig(),
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const { from, to } = aiUsageMonthWindow(now);
    const aggregate = await tx.aiUsage.aggregate({
      where: { userId, createdAt: { gte: from, lt: to } },
      _sum: { toolCalls: true },
    });
    if ((aggregate._sum.toolCalls ?? 0) >= config.monthlyToolCallLimit) {
      throw new AiCrmError(
        "MONTHLY_TOOL_LIMIT",
        "Du hast dein AI-Nutzungslimit für diesen Monat erreicht.",
        429,
      );
    }
    return tx.aiUsage.update({
      where: { id: usageId, userId },
      data: { toolCalls: { increment: 1 } },
    });
  });
}

export async function monthlyAiUsage(
  db: Pick<PrismaClient, "aiUsage">,
  userId: string,
  now = new Date(),
) {
  const { from, to } = aiUsageMonthWindow(now);
  return db.aiUsage.aggregate({
    where: { userId, createdAt: { gte: from, lt: to } },
    _count: { _all: true },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      audioSeconds: true,
      toolCalls: true,
      estimatedCostMicros: true,
    },
    _max: { createdAt: true },
  });
}
