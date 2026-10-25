import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scheduleContactPilot } from "@/lib/pilots/service";
import { suitableDaysSchema } from "@/lib/pilots/schema";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ pilotId: string }> }) {
  try { requireWorkOrigin(request); const user = await requireUser(); const input = await parseWorkBody(request, z.object({ suitableDays: suitableDaysSchema }).strict()); return workResponse({ pilot: await scheduleContactPilot(prisma, user.id, (await context.params).pilotId, input.suitableDays) }); }
  catch (error) { return workErrorResponse(error); }
}
