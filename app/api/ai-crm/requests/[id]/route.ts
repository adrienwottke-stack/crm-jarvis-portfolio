import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { requestView } from "@/lib/ai-crm/presentation";
import { cancelActionPlans, executeActionPlan, reviseActionPlan } from "@/lib/ai-crm/action-plans";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    await requireAiEntitlement(prisma, user.id);
    return Response.json(await requestView(prisma, user.id, (await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error); }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), actionIds: z.array(z.string().min(1)).min(1).max(12), revisions: z.record(z.string(), z.string().min(1)) }).strict(),
  z.object({ action: z.literal("revise"), actionId: z.string().min(1), revision: z.string().min(1), values: z.record(z.string(), z.string().max(8000)) }).strict(),
  z.object({ action: z.literal("cancel"), actionIds: z.array(z.string().min(1)).min(1).max(12).optional() }).strict(),
]);
export async function POST(request: Request, { params }: Params) {
  try {
    if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    const user = await requireUser(); await requireAiEntitlement(prisma, user.id);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AiCrmError("INVALID_REQUEST", "Diese Bestätigung ist ungültig.", 400);
    const current = await requestView(prisma, user.id, (await params).id);
    if (parsed.data.action === "cancel") await cancelActionPlans(prisma, user.id, current.id, parsed.data.actionIds);
    else if (parsed.data.action === "revise") await reviseActionPlan(prisma, { userId: user.id, requestId: current.id, ...parsed.data });
    else {
      // The browser can select only complete immutable plans belonging to this
      // request. It cannot supply tool names, parameters or new values.
      if (parsed.data.actionIds.some(id => !current.actions.some(item => item.id === id))) throw new AiCrmError("PLAN_NOT_FOUND", "Diese Vorschau gehört nicht zur Anfrage.", 404);
      await executeActionPlan(prisma, { userId: user.id, requestId: current.id, actionIds: parsed.data.actionIds, revisions: parsed.data.revisions });
    }
    const result = await requestView(prisma, user.id, current.id);
    for (const path of ["/heute", "/namen", "/kalender", "/trichter", ...result.actions.flatMap(item => item.link ? [item.link] : [])]) revalidatePath(path);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return aiErrorResponse(error); }
}
