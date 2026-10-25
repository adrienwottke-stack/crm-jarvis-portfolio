import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createContactPilot, listContactPilots, previewContactPilot } from "@/lib/pilots/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const user = await requireUser(); const code = new URL(request.url).searchParams.get("joinCode"); return workResponse(code ? { preview: await previewContactPilot(prisma, user.id, code) } : { pilots: await listContactPilots(prisma, user.id) }); }
  catch (error) { return workErrorResponse(error); }
}
export async function POST(request: Request) {
  try { requireWorkOrigin(request); const user = await requireUser(); const input = await parseWorkBody(request, z.object({ weekOne: z.string().length(10) }).strict()); return workResponse({ pilot: await createContactPilot(prisma, user.id, input.weekOne) }); }
  catch (error) { return workErrorResponse(error); }
}
