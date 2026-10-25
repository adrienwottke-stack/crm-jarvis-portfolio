import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordReleaseEvent, ReleaseError } from "@/lib/releases/service";
import { requireReleaseOrigin, releaseErrorResponse } from "@/lib/releases/http";

export const dynamic = "force-dynamic";
const body = z.object({ releaseId: z.string().min(1).max(120), type: z.enum(["IN_APP_VIEWED", "PUSH_OPENED", "ACTION_CLICKED"]) }).strict();
export async function POST(request: Request) {
  try {
    requireReleaseOrigin(request);
    const user = await requireUser();
    const input = body.safeParse(await request.json());
    if (!input.success) throw new ReleaseError("INVALID_INPUT", "Unbekanntes Update-Ereignis.");
    return Response.json(await recordReleaseEvent(prisma, user.id, input.data.releaseId, input.data.type), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return releaseErrorResponse(error); }
}
