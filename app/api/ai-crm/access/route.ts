import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig, formatAiPrice } from "@/lib/ai-crm/config";
import { aiEntitlement, monthlyAiUsage } from "@/lib/ai-crm/entitlement";
import { aiErrorResponse } from "@/lib/ai-crm/http";
import { executionModesEnabled } from "@/lib/ai-crm/execution-policy";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const config = aiCrmConfig();
    const access = await aiEntitlement(prisma, user.id, new Date(), config);
    const usage = access.allowed ? await monthlyAiUsage(prisma, user.id) : null;
    const subscription = await prisma.aiSubscription.findUnique({ where: { userId: user.id }, select: { customerId: true } });
    const limited = usage && (usage._count._all >= config.monthlyRequestLimit || (usage._sum.toolCalls ?? 0) >= config.monthlyToolCallLimit);
    return Response.json({ executionModesEnabled: executionModesEnabled(), userId: user.id, enabled: access.allowed && !limited, liveAvailable: access.allowed && config.liveProvider !== "disabled", reason: limited ? "MONTHLY_REQUEST_LIMIT" : access.reason,
      priceLabel: formatAiPrice(config), billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_AI_PRICE_ID), hasBillingAccount: Boolean(subscription?.customerId),
      monthlyRequests: usage?._count._all ?? 0, monthlyRequestLimit: config.monthlyRequestLimit, monthlyAudioSeconds: usage?._sum.audioSeconds ?? 0, monthlyAudioSecondsLimit: config.monthlyAudioSecondsLimit,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error); }
}
