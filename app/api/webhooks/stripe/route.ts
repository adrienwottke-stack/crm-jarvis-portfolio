import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  claimStripeEvent,
  finishStripeEvent,
  releaseStripeEvent,
  stripe,
  syncStripeSubscription,
} from "@/lib/ai-crm/billing";
import { AiCrmError } from "@/lib/ai-crm/errors";

export const dynamic = "force-dynamic";

function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET fehlt.");
  return secret;
}

function subscriptionId(value: string | Stripe.Subscription | null): string | null {
  return typeof value === "string" ? value : value?.id ?? null;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Signatur fehlt.", { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret(),
    );
  } catch {
    return new Response("Ungültige Signatur.", { status: 400 });
  }

  if (!(await claimStripeEvent(prisma, event.id, event.type))) {
    return new Response(null, { status: 204 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const id = subscriptionId(session.subscription);
      const userId = session.metadata?.userId || session.client_reference_id || undefined;
      if (id) {
        const subscription = await stripe().subscriptions.retrieve(id);
        await syncStripeSubscription(prisma, subscription, userId);
      }
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncStripeSubscription(prisma, event.data.object as Stripe.Subscription);
    }
    await finishStripeEvent(prisma, event.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    const errorCode =
      error instanceof AiCrmError ? error.code : "STRIPE_PROVIDER_ERROR";
    await releaseStripeEvent(prisma, event.id, errorCode).catch(() => undefined);
    console.error("Stripe AI webhook failed", {
      eventId: event.id,
      type: event.type,
      code: errorCode,
    });
    return new Response("Verarbeitung fehlgeschlagen.", { status: 500 });
  }
}
