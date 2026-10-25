import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { aiErrorResponse, sameOrigin } from "@/lib/ai-crm/http";
import { createMemoryEntry, listMemoryEntries, readMemoryBody } from "@/lib/ai-crm/memory";
import { MEMORY_CONTENT_LIMIT, MEMORY_ENTRY_LIMIT } from "@/lib/ai-crm/memory-contracts";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Personal data management remains available without an active AI subscription. */
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ entries: await listMemoryEntries(prisma, user.id), limit: MEMORY_ENTRY_LIMIT, maxContentLength: MEMORY_CONTENT_LIMIT }, { headers });
  } catch (error) { return aiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new AiCrmError("ORIGIN_DENIED", "Nicht erlaubt.", 403);
    const user = await requireUser();
    const entry = await createMemoryEntry(prisma, { userId: user.id, input: await readMemoryBody(request) });
    return Response.json({ entry }, { status: 201, headers });
  } catch (error) { return aiErrorResponse(error); }
}
