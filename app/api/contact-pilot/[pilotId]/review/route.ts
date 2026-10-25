import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reviewContactPilot } from "@/lib/pilots/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ pilotId: string }> }) {
  try { requireWorkOrigin(request); const user = await requireUser(); await parseWorkBody(request, z.object({}).strict()); return workResponse({ pilot: await reviewContactPilot(prisma, user.id, (await context.params).pilotId) }); }
  catch (error) { return workErrorResponse(error); }
}
