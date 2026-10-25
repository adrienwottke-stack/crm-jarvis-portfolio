import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { completeWorkTask } from "@/lib/workflows/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
const schema = z.object({ version: z.number().int().nonnegative(), proofRevision: z.string().length(64), resultCorrect: z.literal(true), activityId: z.string().min(1).max(120).optional(),
  preparationRequestId: z.string().min(1).max(120).optional(), nextActionRequired: z.boolean(), followUpId: z.string().min(1).max(120).optional(), correctionCount: z.number().int().min(0).max(100).nullable().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  try { requireWorkOrigin(request); const user = await requireUser(); return workResponse({ task: await completeWorkTask(prisma, user.id, (await context.params).taskId, await parseWorkBody(request, schema)) }); }
  catch (error) { return workErrorResponse(error); }
}
