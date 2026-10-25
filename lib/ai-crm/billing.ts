import type { PrismaClient } from "@/lib/generated/prisma/client";
import Stripe from "stripe";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiCrmConfig, type AiCrmConfig } from "@/lib/ai-crm/config";

let stripeClient: Stripe | null = null;

export function stripe(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) {
    throw new AiCrmError(
      "BILLING_NOT_CONFIGURED",
      "Das Abo ist noch nicht vollständig eingerichtet.",
      503,
    );
  }
  const config = aiCrmConfig();
  stripeClient ??= new Stripe(apiKey, {
    timeout: config.stripeTimeoutMs,
    maxNetworkRetries: config.stripeMaxRetries,
  });
  return stripeClient;
}

export function stripePriceId(): string {
  const priceId = process.env.STRIPE_AI_PRICE_ID?.trim();
  if (!priceId) {
    throw new AiCrmError(
      "BILLING_NOT_CONFIGURED",
      "Das Abo ist noch nicht vollständig eingerichtet.",
      503,
    );
  }
  return priceId;
}

export async function validateStripePrice(config: AiCrmConfig) {
  const price = await stripe().prices.retrieve(stripePriceId());
  const valid =
    price.active &&
    price.currency.toLowerCase() === config.currency &&
    price.unit_amount === config.productPriceCents &&
    price.type === "recurring" &&
    price.recurring?.interval === "month";
  if (!valid) {
    throw new AiCrmError(
      "BILLING_PRICE_MISMATCH",
      "Das Abo ist noch nicht vollständig eingerichtet.",
      503,
    );
  }
  return price;
}

export function appUrl(requestUrl?: string): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function id(value: string | { id: string } | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

function periodEnd(subscription: Stripe.Subscription): Date | null {
  const seconds = Math.max(
    0,
    ...subscription.items.data.map((item) => item.current_period_end ?? 0),
  );
  return seconds > 0 ? new Date(seconds * 1000) : null;
}

export async function syncStripeSubscription(
  db: Pick<PrismaClient, "aiSubscription">,
  subscription: Stripe.Subscription,
  fallbackUserId?: string,
) {
  const expectedPriceId = stripePriceId();
  const hasExpectedPrice = subscription.items.data.some(
    (item) => item.price.id === expectedPriceId,
  );
  if (!hasExpectedPrice) {
    throw new AiCrmError(
      "BILLING_PRICE_MISMATCH",
      "Dieses Abo gehört nicht zum AI CRM Add-on.",
      422,
    );
  }
  const subscriptionId = subscription.id;
  const customerId = id(subscription.customer);
  const existing = await db.aiSubscription.findFirst({
    where: {
      OR: [
        { subscriptionId },
        ...(customerId ? [{ customerId }] : []),
      ],
    },
    select: { userId: true },
  });
  const userId = subscription.metadata.userId || fallbackUserId || existing?.userId;
  if (!userId) {
    throw new AiCrmError(
      "BILLING_USER_MISSING",
      "Die Zahlung konnte keinem CRM-Konto zugeordnet werden.",
      422,
    );
  }
  return db.aiSubscription.upsert({
    where: { userId },
    create: {
      userId,
      customerId,
      subscriptionId,
      priceId: expectedPriceId,
      status: subscription.status.toUpperCase(),
      currentPeriodEnd: periodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      customerId,
      subscriptionId,
      priceId: expectedPriceId,
      status: subscription.status.toUpperCase(),
      currentPeriodEnd: periodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}

export async function claimStripeEvent(
  db: Pick<PrismaClient, "aiWebhookEvent">,
  providerEventId: string,
  type: string,
  now = new Date(),
  staleAfterMs = aiCrmConfig().stripeTimeoutMs + 15_000,
): Promise<boolean> {
  const result = await db.aiWebhookEvent.createMany({
    data: [
      {
        providerEventId,
        type,
        status: "PROCESSING",
        attempts: 1,
        lastAttemptAt: now,
        createdAt: now,
      },
    ],
    skipDuplicates: true,
  });
  if (result.count === 1) return true;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const reclaimed = await db.aiWebhookEvent.updateMany({
    where: {
      providerEventId,
      processedAt: null,
      OR: [
        { status: "FAILED" },
        { status: "PROCESSING", lastAttemptAt: { lte: staleBefore } },
      ],
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      lastAttemptAt: now,
      lastErrorCode: null,
    },
  });
  return reclaimed.count === 1;
}

export async function finishStripeEvent(
  db: Pick<PrismaClient, "aiWebhookEvent">,
  providerEventId: string,
  now = new Date(),
) {
  await db.aiWebhookEvent.update({
    where: { providerEventId },
    data: {
      status: "PROCESSED",
      processedAt: now,
      lastAttemptAt: now,
      lastErrorCode: null,
    },
  });
}

export async function releaseStripeEvent(
  db: Pick<PrismaClient, "aiWebhookEvent">,
  providerEventId: string,
  errorCode = "STRIPE_PROVIDER_ERROR",
  now = new Date(),
) {
  await db.aiWebhookEvent.updateMany({
    where: { providerEventId, processedAt: null, status: "PROCESSING" },
    data: {
      status: "FAILED",
      lastAttemptAt: now,
      lastErrorCode: errorCode,
    },
  });
}
