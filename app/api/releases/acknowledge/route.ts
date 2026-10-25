import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acknowledgeReleases, ReleaseError } from "@/lib/releases/service";
import { requireReleaseOrigin, releaseErrorResponse } from "@/lib/releases/http";

export const dynamic = "force-dynamic";
const body = z.object({ releaseIds: z.array(z.string().min(1).max(120)).min(1).max(100) }).strict();
export async function POST(request: Request) {
  try {
    requireReleaseOrigin(request);
    const user = await requireUser();
    const input = body.safeParse(await request.json());
    if (!input.success) throw new ReleaseError("INVALID_INPUT", "Wähle ein veröffentlichtes Update.");
    return Response.json(await acknowledgeReleases(prisma, user.id, input.data.releaseIds), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return releaseErrorResponse(error); }
}
