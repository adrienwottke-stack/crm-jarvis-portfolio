import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { appUrl, stripe } from "@/lib/ai-crm/billing";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    const user = await requireUser();
    const subscription = await prisma.aiSubscription.findUnique({ where: { userId: user.id } });
    if (!subscription?.customerId) {
      throw new AiCrmError("BILLING_ACCOUNT_MISSING", "Für dein Konto gibt es noch kein verwaltbares Abo.", 404);
    }
    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.customerId,
      return_url: `${appUrl(request.url)}/heute`,
    });
    return Response.json(
      { url: session.url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return aiErrorResponse(error);
  }
}
