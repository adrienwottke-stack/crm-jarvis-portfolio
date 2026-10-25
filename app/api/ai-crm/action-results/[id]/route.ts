import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { aiErrorResponse } from "@/lib/ai-crm/http";
import { AiCrmError } from "@/lib/ai-crm/errors";

export const dynamic = "force-dynamic";

/** A protected native result, not an authentication token in the conversation. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    await requireAiEntitlement(prisma, user.id);
    if (user.role !== "ADMIN") throw new AiCrmError("FORBIDDEN", "Hierfür sind Verwaltungsrechte erforderlich.", 403);
    const execution = await prisma.aiToolExecution.findFirst({ where: { id: (await params).id, userId: user.id, status: "COMPLETED", request: { expiresAt: { gt: new Date() } } }, select: { result: true } });
    const result = execution?.result as { privateResult?: { resetId?: string } } | null;
    const reset = result?.privateResult?.resetId ? await prisma.passwortReset.findFirst({ where: { id: result.privateResult.resetId, usedAt: null, expiresAt: { gt: new Date() } }, select: { code: true } }) : null;
    if (!reset) throw new AiCrmError("NOT_FOUND", "Dieses Ergebnis ist nicht mehr verfügbar.", 404);
    return new Response(null, { status: 303, headers: { Location: new URL(`/team?reset=${encodeURIComponent(reset.code)}`, request.url).href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return aiErrorResponse(error); }
}
