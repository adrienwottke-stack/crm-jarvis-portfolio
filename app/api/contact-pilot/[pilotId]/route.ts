import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contactPilotDetail } from "@/lib/pilots/service";
import { workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function GET(_: Request, context: { params: Promise<{ pilotId: string }> }) { try { const user = await requireUser(); return workResponse(await contactPilotDetail(prisma, user.id, (await context.params).pilotId)); } catch (error) { return workErrorResponse(error); } }
