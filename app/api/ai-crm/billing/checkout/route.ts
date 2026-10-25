import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { appUrl, stripe, validateStripePrice } from "@/lib/ai-crm/billing";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import {
  claimAiRequest,
  completeAiRequest,
  failAiRequest,
  hashAiRequestInput,
} from "@/lib/ai-crm/requests";

const bodySchema = z.object({ clientRequestId: z.uuid() }).strict();

export async function POST(request: Request) {
  let aiRequestId: string | null = null;
  let userId: string | null = null;
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
        "Der Checkout konnte nicht sicher gestartet werden.",
      );
    }
    const config = aiCrmConfig();
    const now = new Date();
    const claimed = await claimAiRequest(prisma, {
      userId: user.id,
      clientRequestId: parsed.data.clientRequestId,
      kind: "CHECKOUT",
      inputHash: hashAiRequestInput({ kind: "checkout" }),
      now,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      staleAfterMs: config.stripeTimeoutMs + 15_000,
    });
    aiRequestId = claimed.request.id;
    if (claimed.kind === "REPLAY") {
      return Response.json(claimed.response, {
        headers: { "Cache-Control": "no-store", "X-AI-Replayed": "1" },
      });
    }
    if (claimed.kind === "IN_PROGRESS") {
      throw new AiCrmError(
        "REQUEST_IN_PROGRESS",
        "Der Checkout wird bereits vorbereitet. Bitte warte einen Moment.",
        409,
      );
    }
    const existing = await prisma.aiSubscription.findUnique({
      where: { userId: user.id },
    });
    const base = appUrl(request.url);
    const price = await validateStripePrice(config);
    const session = await stripe().checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: price.id, quantity: 1 }],
        client_reference_id: user.id,
        customer: existing?.customerId ?? undefined,
        customer_email: existing?.customerId ? undefined : (user.email ?? undefined),
        allow_promotion_codes: true,
        success_url: base + "/heute?ai=aktiviert",
        cancel_url: base + "/heute?ai=abgebrochen",
        metadata: { userId: user.id },
        subscription_data: { metadata: { userId: user.id } },
      },
      {
        idempotencyKey: ["ai-checkout", user.id, parsed.data.clientRequestId].join(":"),
      },
    );
    if (!session.url) {
      throw new AiCrmError(
        "CHECKOUT_URL_MISSING",
        "Das Abo konnte gerade nicht geöffnet werden.",
        502,
      );
    }
    const response = { url: session.url };
    await completeAiRequest(prisma, claimed.request.id, user.id, response);
    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code =
      error instanceof AiCrmError ? error.code : "STRIPE_PROVIDER_ERROR";
    if (aiRequestId && userId) {
      await failAiRequest(prisma, aiRequestId, userId, code, "FAILED").catch(
        () => undefined,
      );
    }
    return aiErrorResponse(error, aiRequestId ?? undefined);
  }
}
