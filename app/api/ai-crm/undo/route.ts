import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiCrmConfig } from "@/lib/ai-crm/config";
import { requireAiEntitlement } from "@/lib/ai-crm/entitlement";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { undoAusfuehren } from "@/lib/undo";

const schema = z.object({ entryId: z.string().trim().min(1) });

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    const user = await requireUser();
    await requireAiEntitlement(prisma, user.id, new Date(), aiCrmConfig());
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AiCrmError("INVALID_REQUEST", "Rückgängig ist nicht mehr möglich.");
    const label = await undoAusfuehren(user.id, parsed.data.entryId);
    if (!label) {
      throw new AiCrmError(
        "UNDO_EXPIRED",
        "Diese Änderung kann nicht mehr rückgängig gemacht werden.",
        409,
      );
    }
    revalidatePath("/heute");
    revalidatePath("/namen");
    revalidatePath("/trichter");
    return Response.json({ label }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
