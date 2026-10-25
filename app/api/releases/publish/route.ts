import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { confirmReleasePublication, ReleaseError, releaseDeliveryReport } from "@/lib/releases/service";
import { requireReleaseOrigin, releaseErrorResponse } from "@/lib/releases/http";

export const dynamic = "force-dynamic";
const body = z.object({ releaseId: z.string().min(1).max(120), deploymentId: z.string().min(1).max(200), confirmedSuccessfulProduction: z.literal(true) }).strict();
export async function POST(request: Request) {
  try {
    requireReleaseOrigin(request);
    const user = await requireUser();
    const input = body.safeParse(await request.json());
    if (!input.success) throw new ReleaseError("INVALID_INPUT", "Bestätige die erfolgreiche Production-Veröffentlichung und ihre Deployment-Kennung.");
    const publication = await confirmReleasePublication(prisma, { userId: user.id, ...input.data });
    return Response.json({ publication, report: await releaseDeliveryReport(prisma, input.data.releaseId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return releaseErrorResponse(error); }
}
