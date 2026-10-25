import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CONTACT_ORIGINS } from "@/lib/workflows/contracts";
import { contactCohortForUser, confirmFirstContact, registerContactCohort } from "@/lib/workflows/service";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const user = await requireUser(); const parsed = z.string().min(1).max(120).safeParse(new URL(request.url).searchParams.get("contactId"));
    if (!parsed.success) return workResponse({ cohort: null });
    return workResponse({ cohort: await contactCohortForUser(prisma, user.id, parsed.data) }); }
  catch (error) { return workErrorResponse(error); }
}
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("REGISTER"), contactId: z.string().min(1).max(120), origin: z.enum(CONTACT_ORIGINS) }).strict(),
  z.object({ action: z.literal("CONFIRM_FIRST_CONTACT"), taskId: z.string().min(1).max(120), conversationConfirmed: z.literal(true) }).strict()]);
export async function POST(request: Request) {
  try { requireWorkOrigin(request); const user = await requireUser(); const input = await parseWorkBody(request, schema);
    return workResponse({ cohort: input.action === "REGISTER" ? await registerContactCohort(prisma, user.id, input.contactId, input.origin) : await confirmFirstContact(prisma, user.id, input.taskId) }); }
  catch (error) { return workErrorResponse(error); }
}
