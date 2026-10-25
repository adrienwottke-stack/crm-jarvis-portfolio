import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { workTaskReport } from "@/lib/workflows/report";
import { workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function GET() { try { const user = await requireUser(); return workResponse({ report: await workTaskReport(prisma, user.id) }); } catch (error) { return workErrorResponse(error); } }
