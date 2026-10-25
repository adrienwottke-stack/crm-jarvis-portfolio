import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WORK_TASK_KINDS, WORK_TASK_ROUTES } from "@/lib/workflows/contracts";
import { listWorkTasks, startWorkTask } from "@/lib/workflows/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
const schema = z.object({ clientTaskId: z.uuid(), kind: z.enum(WORK_TASK_KINDS), route: z.enum(WORK_TASK_ROUTES), contactId: z.string().min(1).max(120) }).strict();
export async function GET(request: Request) {
  try { const user = await requireUser(); const contactId = new URL(request.url).searchParams.get("contactId") ?? undefined; return workResponse({ tasks: await listWorkTasks(prisma, user.id, contactId) }); }
  catch (error) { return workErrorResponse(error); }
}
export async function POST(request: Request) {
  try { requireWorkOrigin(request); const user = await requireUser(); return workResponse({ task: await startWorkTask(prisma, user.id, await parseWorkBody(request, schema)) }); }
  catch (error) { return workErrorResponse(error); }
}
