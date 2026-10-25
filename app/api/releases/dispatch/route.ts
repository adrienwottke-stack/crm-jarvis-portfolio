import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dispatchRelease } from "@/lib/releases/delivery";
import { ReleaseError } from "@/lib/releases/service";
import { requireReleaseOrigin, releaseErrorResponse } from "@/lib/releases/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const body = z.object({ releaseId: z.string().min(1).max(120), deploymentId: z.string().min(1).max(200), confirmDispatch: z.literal(true) }).strict();
export async function POST(request: Request) {
  try {
    requireReleaseOrigin(request);
    const user = await requireUser();
    const input = body.safeParse(await request.json());
    if (!input.success) throw new ReleaseError("INVALID_INPUT", "Bestätige den Versand des veröffentlichten Updates.");
    return Response.json(await dispatchRelease(prisma, { userId: user.id, ...input.data }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return releaseErrorResponse(error); }
}
