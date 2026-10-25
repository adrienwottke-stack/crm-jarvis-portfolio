import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { changeWorkRoute, workTaskDetail } from "@/lib/workflows/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
type Context = { params: Promise<{ taskId: string }> };
export const dynamic = "force-dynamic";
export async function GET(_: Request, context: Context) {
  try { const user = await requireUser(); return workResponse(await workTaskDetail(prisma, user.id, (await context.params).taskId)); }
  catch (error) { return workErrorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try { requireWorkOrigin(request); const user = await requireUser(); const input = await parseWorkBody(request, z.object({ version: z.number().int().nonnegative(), route: z.literal("MIXED") }).strict());
    return workResponse({ task: await changeWorkRoute(prisma, user.id, (await context.params).taskId, input.version) }); }
  catch (error) { return workErrorResponse(error); }
}
