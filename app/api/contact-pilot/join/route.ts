import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { joinContactPilot } from "@/lib/pilots/service";
import { suitableDaysSchema } from "@/lib/pilots/schema";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { requireWorkOrigin(request); const user = await requireUser(); const input = await parseWorkBody(request, z.object({ joinCode: z.string().trim().min(8).max(100), consent: z.literal(true), suitableDays: suitableDaysSchema }).strict()); return workResponse({ pilot: await joinContactPilot(prisma, user.id, input) }); }
  catch (error) { return workErrorResponse(error); }
}
