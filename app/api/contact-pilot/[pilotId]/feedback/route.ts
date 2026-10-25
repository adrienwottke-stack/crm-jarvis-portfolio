import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordPilotFeedback } from "@/lib/pilots/service";
import { PILOT_CONVERSATION_KINDS, PILOT_HURDLES } from "@/lib/pilots/contracts";
import { parseWorkBody, requireWorkOrigin, workErrorResponse, workResponse } from "@/lib/workflows/http";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("CONVERSATION"), taskId: z.string().min(1).max(120), conversationKind: z.enum(PILOT_CONVERSATION_KINDS), conversationConfirmed: z.boolean() }).strict(),
  z.object({ action: z.literal("HURDLE"), hurdle: z.enum(PILOT_HURDLES), clientObservationId: z.uuid(), roundObserved: z.literal(true) }).strict(), z.object({ action: z.literal("WEEK_REVIEW"), week: z.union([z.literal(1), z.literal(2)]) }).strict()]);
export async function POST(request: Request, context: { params: Promise<{ pilotId: string }> }) {
  try { requireWorkOrigin(request); const user = await requireUser(); return workResponse(await recordPilotFeedback(prisma, user.id, (await context.params).pilotId, await parseWorkBody(request, schema))); }
  catch (error) { return workErrorResponse(error); }
}
