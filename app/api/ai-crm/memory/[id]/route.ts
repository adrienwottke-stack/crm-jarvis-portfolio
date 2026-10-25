import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { deleteMemoryEntry, memoryVersion, readMemoryBody, updateMemoryEntry } from "@/lib/ai-crm/memory";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    const user = await requireUser(), { id } = await context.params;
    const entry = await updateMemoryEntry(prisma, { userId: user.id, id, input: await readMemoryBody(request) });
    return Response.json({ entry }, { headers });
  } catch (error) { return aiErrorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    const user = await requireUser(), { id } = await context.params;
    const version = memoryVersion(await readMemoryBody(request));
    return Response.json(await deleteMemoryEntry(prisma, { userId: user.id, id, version }), { headers });
  } catch (error) { return aiErrorResponse(error); }
}
