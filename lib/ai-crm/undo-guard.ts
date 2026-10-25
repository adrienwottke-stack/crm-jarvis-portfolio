import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { hashAiRequestInput } from "@/lib/ai-crm/requests";
export const sameAiUndoState = (left: unknown, right: unknown) => hashAiRequestInput(left) === hashAiRequestInput(right);
type Db = PrismaClient | Prisma.TransactionClient;
export type AiUndoGuard = { fields: string[]; activityIds: string[]; followUpIds: string[]; state: unknown };
export async function aiUndoState(db: Db, userId: string, contactId: string, guard: Omit<AiUndoGuard, "state">) {
  const contact = await db.contact.findFirst({ where: { id: contactId, ownerId: userId } });
  const activities = guard.activityIds.length ? await db.activity.findMany({ where: { id: { in: guard.activityIds }, contactId, contact: { ownerId: userId } }, orderBy: { id: "asc" }, select: { id: true, type: true, text: true, date: true } }) : [];
  const followUps = guard.followUpIds.length ? await db.contactFollowUp.findMany({ where: { id: { in: guard.followUpIds }, contactId, ownerId: userId }, orderBy: { id: "asc" }, select: { id: true, type: true, at: true, note: true, status: true } }) : [];
  return JSON.parse(JSON.stringify({ contact: contact ? Object.fromEntries(guard.fields.map(field => [field, (contact as unknown as Record<string, unknown>)[field]])) : null, activities, followUps }));
}
