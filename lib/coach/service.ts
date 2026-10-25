import type { PrismaClient } from "@/lib/generated/prisma/client";
import { userTransaction } from "@/lib/start/service";
import { isDemoId, nextCoachStep, type CoachFacts, type CoachView } from "@/lib/coach/model";

export async function miniEmilEnabled(db: PrismaClient) {
  const rows = await db.feature.findMany({ where: { key: { in: ["miniEmil", "startfuehrung"] } }, select: { key: true, state: true } });
  return ["miniEmil", "startfuehrung"].every(key => rows.some(row => row.key === key && (row.state === "TEST" || row.state === "LAEUFT")));
}

/** Reconcile from owned contacts, including after undo. Aggregate/manual counters are not evidence. */
export async function loadCoach(db: PrismaClient, userId: string, activate = false): Promise<CoachView | null> {
  if (!await miniEmilEnabled(db)) return null;
  return userTransaction(db, userId, async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingDoneAt: true, startTrack: true, role: true } });
    if (!user.onboardingDoneAt) return null;
    let state = await tx.startProgress.findUnique({ where: { userId } });
    // Legacy completed accounts and the separate leader intro are opt-in only.
    const available: CoachView = { kind: user.startTrack, status: "available", phase: "COLLECTION", demo: "names", message: "Ich zeige dir den Weg vom ersten Namen bis zum Terminergebnis.", action: { label: "Mit Emil starten", href: "/profil?emil=1" }, seen: [], waiting: false };
    if ((!state || state.version < 2 && state.phase === "DONE" || user.role === "ADMIN" && state.version < 2) && !activate) return available;
    if (state?.phase === "INTRO" && !activate) return available;
    if (!state) state = await tx.startProgress.create({ data: { userId, version: 2, phase: "COLLECTION", kind: user.startTrack } });
    else if (state.version < 2 || activate && state.paused) state = await tx.startProgress.update({ where: { userId }, data: { version: 2, ...(activate ? { paused: false } : {}), revision: { increment: 1 } } });
    const kind = state.kind ?? user.startTrack;
    const own = { ownerId: userId, ...(kind ? { listKinds: { has: kind } } : {}) };
    const now = new Date();
    const [names, round, held, appointment, callable, waitingCall, phoneContact, calls] = await Promise.all([
      tx.contact.count({ where: own }),
      state.collectionId ? tx.nameCollection.findFirst({ where: { id: state.collectionId, userId, ...(kind ? { kind } : {}) }, select: { id: true, completedAt: true } }) : null,
      tx.contact.findFirst({ where: { ...own, appointmentHeldLoggedAt: { not: null } }, orderBy: [{ appointmentHeldLoggedAt: "asc" }, { id: "asc" }], select: { id: true, name: true, referralsAskedAt: true, wonLoggedAt: true, outcome: true, einheitenErinnerungen: { where: { userId }, orderBy: { createdAt: "desc" }, take: 1, select: { buchungId: true } } } }),
      tx.contact.findFirst({ where: { ...own, outcome: "OFFEN", nextStepType: "TERMIN", nextStepAt: { not: null } }, orderBy: [{ nextStepAt: "asc" }, { id: "asc" }], select: { id: true, name: true, nextStepAt: true } }),
      tx.contact.findFirst({ where: { ...own, outcome: "OFFEN", stage: { in: ["NEU", "KONTAKTIERT", "TERMIN_VEREINBART"] }, phone: { not: null }, OR: [{ nextStepType: null }, { nextStepType: "ANRUF", nextStepAt: { lte: now } }] }, orderBy: [{ rating: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
      tx.contact.findFirst({ where: { ...own, outcome: "OFFEN", nextStepType: "ANRUF", nextStepAt: { gt: now }, phone: { not: null } }, orderBy: [{ nextStepAt: "asc" }, { id: "asc" }], select: { id: true, name: true, nextStepAt: true } }),
      tx.contact.findFirst({ where: { ...own, outcome: "OFFEN", phone: null, stage: { in: ["NEU", "KONTAKTIERT"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
      tx.activity.count({ where: { type: "CALL", contact: own } }),
    ]);
    // Old closes may precede the reminder system; recognise only later positive entries there.
    const legacyUnits = held?.wonLoggedAt && held.einheitenErinnerungen.length === 0 ? await tx.einheitenbuchung.count({ where: { userId, hundertstel: { gt: 0 }, createdAt: { gte: held.wonLoggedAt } } }) : 0;
    const facts: CoachFacts = { kind, names, collectionOpen: !!round && !round.completedAt || state.phase === "COLLECTION" && !round && !activate, collectionId: round && !round.completedAt ? round.id : null, callable, waitingCall: waitingCall?.nextStepAt ? { ...waitingCall, at: waitingCall.nextStepAt.toISOString() } : null, appointment: appointment?.nextStepAt ? { ...appointment, at: appointment.nextStepAt.toISOString() } : null, phoneContact, calls, held: held ? { id: held.id, name: held.name, referralsAsked: !!held.referralsAskedAt, unitsOpen: held.outcome === "GEWONNEN" && !(held.einheitenErinnerungen[0]?.buchungId || legacyUnits) } : null };
    const step = nextCoachStep(facts, now);
    if (step.phase === "UNITS" && held && held.einheitenErinnerungen.length === 0) step.action.href = "/einheiten";
    const contactId = held?.id ?? appointment?.id ?? callable?.id ?? waitingCall?.id ?? phoneContact?.id ?? null;
    if (state.phase !== step.phase || state.coachContactId !== contactId || state.kind !== kind) {
      state = await tx.startProgress.update({ where: { userId }, data: { phase: step.phase, coachContactId: contactId, kind, ...(step.phase === "COLLECTION" && round?.completedAt ? { collectionId: null } : {}), revision: { increment: 1 } } });
    }
    return { ...step, seen: state.coachSeen.filter(isDemoId), status: state.paused ? "paused" : step.phase === "DONE" ? "on-demand" : "active" };
  });
}

export async function acknowledgeDemo(db: PrismaClient, userId: string, demo: string) {
  if (!isDemoId(demo)) throw new Error("Diese Erklärung gibt es nicht.");
  if (!await miniEmilEnabled(db)) return;
  await userTransaction(db, userId, async tx => {
    const state = await tx.startProgress.findUnique({ where: { userId } });
    if (!state || state.version < 2 || state.coachSeen.includes(demo)) return;
    await tx.startProgress.update({ where: { userId }, data: { coachSeen: [...state.coachSeen, demo], revision: { increment: 1 } } });
  });
}
