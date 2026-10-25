import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { releaseStateForUser } from "@/lib/releases/service";
import { releaseErrorResponse } from "@/lib/releases/http";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json(await releaseStateForUser(prisma, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return releaseErrorResponse(error); }
}
