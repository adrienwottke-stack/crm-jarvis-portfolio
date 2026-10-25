import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { hashAiRequestInput } from "@/lib/ai-crm/requests";

/** Authorization fingerprint only: no names, text, or summaries in the cache key. */
export async function leadershipScopeFingerprint(db: PrismaClient | Prisma.TransactionClient, userId: string) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, path: true, leaderId: true, deactivatedAt: true } });
  const agreements = await db.partnerVereinbarung.findMany({ where: { OR: [{ initiatorId: userId }, { empfaengerId: userId }] }, select: { initiatorId: true, empfaengerId: true } });
  const ids = new Set(agreements.flatMap(item => [item.initiatorId, item.empfaengerId]));
  if (me?.leaderId) ids.add(me.leaderId);
  const people = await db.user.findMany({ where: me?.role === "ADMIN" ? {} : { OR: [{ leaderId: userId }, { id: { in: [...ids] } }, ...(me?.path ? [{ path: { startsWith: me.path } }] : [])] }, select: { id: true, path: true, leaderId: true, deactivatedAt: true, passwordHash: true }, orderBy: { id: "asc" } });
  return hashAiRequestInput({ me, people: people.map(({ passwordHash, ...person }) => ({ ...person, activeLogin: Boolean(passwordHash) })) });
}
