import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WORK_TASK_ERRORS } from "@/lib/workflows/contracts";
import { finishWorkTask } from "@/lib/workflows/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try { requireWorkOrigin(request); const user = await requireUser(); const input = await parseWorkBody(request, z.object({ version: z.number().int().nonnegative(), status: z.enum(["CANCELED", "FAILED"]), errorCode: z.enum(WORK_TASK_ERRORS).optional() }).strict());
    return workResponse({ task: await finishWorkTask(prisma, user.id, (await context.params).taskId, input) }); }
  catch (error) { return workErrorResponse(error); }
}
