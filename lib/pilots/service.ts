import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, CrmContactPilot, CrmPilotParticipant } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";
import { berlinDay, evaluateContactPilot } from "@/lib/experiments/contact-pilot";
import { completedConversationProof, evidenceHash, requireWorkUser } from "@/lib/workflows/service";
import type { PilotFeedback, PilotView, SuitableDays } from "@/lib/pilots/contracts";
import { uniqueFirstEncounters } from "@/lib/pilots/report";
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const shift = (day: string, days: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(new Date(`${day}T00:00:00Z`).getTime()) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
function validateDays(days: SuitableDays, weekOne: string, weekTwo: string) {
  if (!Array.isArray(days) || days.length !== 2) throw new AiCrmError("PILOT_DAYS_REQUIRED", "Wähle passende Tage in beiden Wochen.", 400);
  days.forEach((week, i) => {
    const from = i === 0 ? weekOne : weekTwo;
    if (!Array.isArray(week) || week.length < 2 || week.length > 7 || new Set(week).size !== week.length || week.some(day => !validDay(day) || day < from || day >= shift(from, 7))) throw new AiCrmError("PILOT_DAYS_REQUIRED", "Mindestens zwei verschiedene passende Tage je Pilotwoche sind erforderlich.", 400);
  });
}
function frozenIds(pilot: CrmContactPilot): string[] {
  return Array.isArray(pilot.frozenParticipantIds) ? pilot.frozenParticipantIds.filter((row): row is string => typeof row === "string") : [];
}
async function accessiblePilot(db: Db | Tx, userId: string, id: string, coordinator = false) {
  await requireWorkUser(db, userId);
  const pilot = await db.crmContactPilot.findUnique({ where: { id }, include: { participants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!pilot || (pilot.ownerId !== userId && (coordinator || !pilot.participants.some(row => row.userId === userId)))) throw new AiCrmError("PILOT_NOT_FOUND", "Dieser Pilot ist für dein Konto nicht verfügbar.", 404);
  return pilot;
}
function view(pilot: CrmContactPilot & { participants: CrmPilotParticipant[] }, userId: string): PilotView {
  const me = pilot.participants.find(row => row.userId === userId);
  return { id: pilot.id, status: pilot.status as PilotView["status"], weekOne: pilot.weekOne, weekTwo: pilot.weekTwo,
    joinCode: pilot.ownerId === userId ? pilot.joinCode : null, isCoordinator: pilot.ownerId === userId,
    participantCount: pilot.participants.length, frozenParticipantCount: frozenIds(pilot).length,
    startedAt: pilot.startedAt?.toISOString() ?? null, reviewedAt: pilot.reviewedAt?.toISOString() ?? null,
    myParticipant: me ? { id: me.id, alias: me.alias, suitableDays: me.suitableDays as SuitableDays, withdrawnAt: me.withdrawnAt?.toISOString() ?? null } : null };
}
export async function listContactPilots(db: Db, userId: string) {
  await requireWorkUser(db, userId);
  const pilots = await db.crmContactPilot.findMany({ where: { OR: [{ ownerId: userId }, { participants: { some: { userId } } }] }, include: { participants: true }, orderBy: { createdAt: "desc" }, take: 50 });
  return pilots.map(pilot => view(pilot, userId));
}
export async function previewContactPilot(db: Db, userId: string, joinCode: string) {
  await requireWorkUser(db, userId);
  const pilot = await db.crmContactPilot.findUnique({ where: { joinCode }, select: { id: true, weekOne: true, weekTwo: true, status: true, _count: { select: { participants: true } } } });
  if (!pilot) throw new AiCrmError("PILOT_CODE_INVALID", "Dieser Teilnahme-Code ist nicht verfügbar.", 404);
  return { id: pilot.id, weekOne: pilot.weekOne, weekTwo: pilot.weekTwo, status: pilot.status, participantCount: pilot._count.participants };
}
export async function createContactPilot(db: Db, userId: string, weekOne: string, now = new Date()) {
  await requireWorkUser(db, userId);
  if (!validDay(weekOne) || new Date(`${weekOne}T00:00:00Z`).getUTCDay() !== 1 || weekOne <= berlinDay(now)) throw new AiCrmError("PILOT_FUTURE_WEEKS_REQUIRED", "Wähle einen zukünftigen Montag für zwei volle Berliner Kalenderwochen.", 400);
  const pilot = await db.crmContactPilot.create({ data: { ownerId: userId, weekOne, weekTwo: shift(weekOne, 7), joinCode: randomBytes(12).toString("base64url") }, include: { participants: true } });
  return view(pilot, userId);
}
export async function joinContactPilot(db: Db, userId: string, input: { joinCode: string; consent: true; suitableDays: SuitableDays }, now = new Date()) {
  if (input.consent !== true) throw new AiCrmError("PILOT_CONSENT_REQUIRED", "Die Teilnahme ist freiwillig und benötigt deine ausdrückliche Zustimmung.", 400);
  return db.$transaction(async tx => {
    const user = await requireWorkUser(tx, userId);
    if (!user.passwordHash || !user.passwordSalt) throw new AiCrmError("PILOT_ACCOUNT_NOT_READY", "Die Teilnahme benötigt ein vollständig eingerichtetes eigenes Konto.", 403);
    const selected = await tx.crmContactPilot.findUnique({ where: { joinCode: input.joinCode } });
    if (!selected) throw new AiCrmError("PILOT_CODE_INVALID", "Dieser Teilnahme-Code ist nicht verfügbar.", 404);
    await tx.$queryRaw`SELECT "id" FROM "CrmContactPilot" WHERE "id" = ${selected.id} FOR UPDATE`;
    const pilot = await tx.crmContactPilot.findUniqueOrThrow({ where: { id: selected.id }, include: { participants: true } });
    if (pilot.status !== "DRAFT" || berlinDay(now) >= pilot.weekOne) throw new AiCrmError("PILOT_JOIN_CLOSED", "Teilnahme und passende Tage werden vor Pilotbeginn festgelegt.", 409);
    validateDays(input.suitableDays, pilot.weekOne, pilot.weekTwo);
    const existing = pilot.participants.find(row => row.userId === userId);
    if (!existing && pilot.participants.length >= 5) throw new AiCrmError("PILOT_FULL", "Für diesen Pilot sind bereits fünf Personen ausgewählt.", 409);
    const nextAlias = Math.max(0, ...pilot.participants.map(row => Number(row.alias.replace("Person ", "")) || 0)) + 1;
    await tx.crmPilotParticipant.upsert({ where: { pilotId_userId: { pilotId: pilot.id, userId } }, create: { pilotId: pilot.id, userId, alias: `Person ${nextAlias}`, consentedAt: now, suitableDays: input.suitableDays }, update: { suitableDays: input.suitableDays } });
    return view(await tx.crmContactPilot.findUniqueOrThrow({ where: { id: pilot.id }, include: { participants: true } }), userId);
  });
}
export async function scheduleContactPilot(db: Db, userId: string, id: string, days: SuitableDays, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "CrmContactPilot" WHERE "id" = ${id} FOR UPDATE`;
    const pilot = await accessiblePilot(tx, userId, id);
    if (pilot.status !== "DRAFT" || berlinDay(now) >= pilot.weekOne) throw new AiCrmError("PILOT_SCHEDULE_FROZEN", "Die vorab ausgewählten Tage bleiben nach Beginn unverändert.", 409);
    const me = pilot.participants.find(row => row.userId === userId);
    if (!me) throw new AiCrmError("PILOT_PARTICIPATION_REQUIRED", "Tritt dem Pilot zuerst freiwillig bei.", 403);
    validateDays(days, pilot.weekOne, pilot.weekTwo);
    await tx.crmPilotParticipant.update({ where: { id: me.id }, data: { suitableDays: days } });
    return view(await tx.crmContactPilot.findUniqueOrThrow({ where: { id }, include: { participants: true } }), userId);
  });
}
export async function startContactPilot(db: Db, userId: string, id: string, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "CrmContactPilot" WHERE "id" = ${id} FOR UPDATE`;
    const pilot = await accessiblePilot(tx, userId, id, true);
    if (pilot.status === "ACTIVE") return view(pilot, userId);
    if (pilot.status !== "DRAFT" || berlinDay(now) >= pilot.weekOne) throw new AiCrmError("PILOT_START_CLOSED", "Der Pilot muss vor den beiden vollständigen Wochen gestartet werden.", 409);
    if (pilot.participants.length !== 5) throw new AiCrmError("PILOT_FIVE_CONSENTS_REQUIRED", "Der Start benötigt fünf freiwillige Teilnehmer mit passenden Tagen.", 400);
    const ids = pilot.participants.map(row => row.userId);
    const ready = await tx.user.count({ where: { id: { in: ids }, deactivatedAt: null, passwordHash: { not: null, notIn: [""] }, passwordSalt: { not: null, notIn: [""] } } });
    if (ready !== 5) throw new AiCrmError("PILOT_ACCOUNT_NOT_READY", "Alle fünf Teilnehmer benötigen ein aktives eingerichtetes Konto.", 400);
    for (const person of pilot.participants) validateDays(person.suitableDays as SuitableDays, pilot.weekOne, pilot.weekTwo);
    await tx.crmContactPilot.update({ where: { id }, data: { status: "ACTIVE", startedAt: now, frozenParticipantIds: pilot.participants.map(row => row.id) } });
    return view(await tx.crmContactPilot.findUniqueOrThrow({ where: { id }, include: { participants: true } }), userId);
  });
}
export async function recordPilotFeedback(db: Db, userId: string, id: string, input: PilotFeedback, now = new Date()) {
  return db.$transaction(async tx => {
    // Cohort registration locks this same account. Selection and feedback must
    // not race a newly recorded immutable exclusion.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CrmContactPilot" WHERE "id" = ${id} FOR UPDATE`;
    const pilot = await accessiblePilot(tx, userId, id);
    const me = pilot.participants.find(row => row.userId === userId);
    if (!me || me.withdrawnAt) throw new AiCrmError("PILOT_PARTICIPATION_REQUIRED", "Diese Rückmeldung benötigt deine aktive freiwillige Teilnahme.", 403);
    const today = berlinDay(now);
    if (input.action === "HURDLE") {
      if (input.roundObserved !== true) throw new AiCrmError("PILOT_ROUND_CONFIRMATION_REQUIRED", "Bestätige, dass diese Arbeitsrunde tatsächlich stattgefunden hat.", 400);
      if (pilot.status === "REVIEWED" || pilot.status === "ACTIVE" && today >= shift(pilot.weekTwo, 7)) throw new AiCrmError("PILOT_WINDOW_ENDED", "Die Rückmeldungsphase ist beendet.", 409);
      const kind = pilot.status === "DRAFT" || today < pilot.weekOne ? "PREPARATION_HURDLE" : "HURDLE";
      const previous = await tx.crmPilotObservation.findUnique({ where: { id: input.clientObservationId } });
      if (previous) {
        if (previous.pilotId !== id || previous.participantId !== me.id || !["PREPARATION_HURDLE", "HURDLE"].includes(previous.kind) || previous.hurdle !== input.hurdle) throw new AiCrmError("PILOT_OBSERVATION_REPLAY_CHANGED", "Diese Kennung gehört bereits zu einer anderen Rückmeldung.", 409);
        return { id: previous.id };
      }
      return { id: (await tx.crmPilotObservation.create({ data: { id: input.clientObservationId, pilotId: id, participantId: me.id, kind, occurredAt: now, hurdle: input.hurdle } })).id };
    }
    if (pilot.status !== "ACTIVE" || !pilot.startedAt || !frozenIds(pilot).includes(me.id)) throw new AiCrmError("PILOT_NOT_ACTIVE", "Diese Rückmeldung benötigt deine Teilnahme an einem gestarteten Pilot.", 409);
    if (today < pilot.weekOne) throw new AiCrmError("PILOT_WINDOW_NOT_STARTED", "Die erste Pilotwoche hat noch nicht begonnen.", 409);
    if (input.action === "CONVERSATION") {
      const { task, activity } = await completedConversationProof(tx, userId, input.taskId);
      const day = berlinDay(activity.date);
      if (day < pilot.weekOne || day >= shift(pilot.weekTwo, 7) || activity.date > now || task.startedAt < pilot.startedAt) throw new AiCrmError("PILOT_CONVERSATION_OUTSIDE_WINDOW", "Das bestätigte Gespräch muss innerhalb der beiden Pilotwochen liegen.", 400);
      const cohort = await tx.crmContactCohort.findUnique({ where: { userId_contactId: { userId, contactId: task.contactId } } });
      if (cohort && !cohort.eligible) throw new AiCrmError("PILOT_CONTACT_EXCLUDED", "Dieser Kontakt wurde bereits als Test, Duplikat oder Import von der Kontaktmessung ausgeschlossen.", 409);
      if (cohort && input.conversationKind !== "EXISTING_CONTACT" && cohort.origin !== input.conversationKind) throw new AiCrmError("PILOT_CONTACT_ORIGIN_CONFLICT", "Die Art der ersten Begegnung widerspricht der bereits festgelegten Kontaktkohorte. Weitere Gespräche können als bekannter Kontakt erfasst werden.", 409);
      const existing = await tx.crmPilotObservation.findUnique({ where: { taskId: task.id } });
      if (existing) {
        if (existing.pilotId !== id || existing.participantId !== me.id || existing.conversationKind !== input.conversationKind || existing.conversationConfirmed !== input.conversationConfirmed) throw new AiCrmError("PILOT_OBSERVATION_REPLAY_CHANGED", "Diese Arbeit wurde bereits anders bestätigt.", 409);
        return { id: existing.id };
      }
      const contactKey = evidenceHash([pilot.id, me.id, task.contactId]);
      if (input.conversationConfirmed && input.conversationKind !== "EXISTING_CONTACT") {
        const first = await tx.crmPilotObservation.findFirst({ where: { pilotId: id, participantId: me.id, contactKey, kind: "CONVERSATION", conversationConfirmed: true,
          conversationKind: { in: ["NEW_ACQUAINTANCE", "FIRST_REFERRAL"] } }, orderBy: { occurredAt: "asc" } });
        if (first && first.conversationKind !== input.conversationKind) throw new AiCrmError("PILOT_FIRST_ENCOUNTER_CONFLICT", "Für diesen Kontakt ist bereits eine andere Art der ersten Begegnung bestätigt. Weitere Gespräche können als bekannter Kontakt erfasst werden.", 409);
      }
      const row = await tx.crmPilotObservation.create({ data: { pilotId: id, participantId: me.id, taskId: task.id, kind: "CONVERSATION", occurredAt: activity.date,
        contactKey, conversationKind: input.conversationKind, conversationConfirmed: input.conversationConfirmed, resultCorrect: true, nextActionRequired: Boolean(task.nextActionRequired), nextActionCorrect: Boolean(task.nextActionCorrect) } });
      if (input.conversationConfirmed) {
        if (cohort?.eligible && activity.date >= cohort.registeredAt) await tx.crmContactCohort.updateMany({ where: { id: cohort.id, OR: [{ firstConfirmedContactAt: null }, { firstConfirmedContactAt: { gt: activity.date } }] }, data: { firstConfirmedContactAt: activity.date } });
      }
      return { id: row.id };
    }
    if (input.action === "WEEK_REVIEW") {
      const after = shift(input.week === 1 ? pilot.weekOne : pilot.weekTwo, 7);
      if (today < after) throw new AiCrmError("PILOT_WEEK_NOT_COMPLETE", "Der Wochenabschluss wartet auf eine vollständig verstrichene Woche.", 409);
      const previous = await tx.crmPilotObservation.findFirst({ where: { pilotId: id, participantId: me.id, kind: `WEEK_REVIEW_${input.week}` } });
      if (previous) return { id: previous.id };
    }
    const row = await tx.crmPilotObservation.create({ data: { pilotId: id, participantId: me.id, kind: `WEEK_REVIEW_${input.week}`, occurredAt: now } });
    return { id: row.id };
  });
}
export async function leaveContactPilot(db: Db, userId: string, id: string, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "CrmContactPilot" WHERE "id" = ${id} FOR UPDATE`;
    const pilot = await accessiblePilot(tx, userId, id);
    const me = pilot.participants.find(row => row.userId === userId);
    if (!me) throw new AiCrmError("PILOT_PARTICIPATION_REQUIRED", "Du nimmst an diesem Pilot nicht teil.", 400);
    if (pilot.status === "DRAFT") await tx.crmPilotParticipant.delete({ where: { id: me.id } });
    else if (!me.withdrawnAt) await tx.crmPilotParticipant.update({ where: { id: me.id }, data: { withdrawnAt: now } });
    return { left: true, denominatorPreserved: pilot.status !== "DRAFT" };
  });
}
export async function reviewContactPilot(db: Db, userId: string, id: string, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "CrmContactPilot" WHERE "id" = ${id} FOR UPDATE`;
    const pilot = await accessiblePilot(tx, userId, id, true);
    if (pilot.status === "REVIEWED") return view(pilot, userId);
    if (pilot.status !== "ACTIVE" || berlinDay(now) < shift(pilot.weekTwo, 7)) throw new AiCrmError("PILOT_REVIEW_NOT_READY", "Die Datenprüfung benötigt einen gestarteten Pilot und zwei vollständig verstrichene Wochen.", 409);
    await tx.crmContactPilot.update({ where: { id }, data: { status: "REVIEWED", reviewedAt: now } });
    return view(await tx.crmContactPilot.findUniqueOrThrow({ where: { id }, include: { participants: true } }), userId);
  });
}
export async function contactPilotDetail(db: Db, userId: string, id: string, now = new Date()) {
  const pilot = await accessiblePilot(db, userId, id);
  const selected = frozenIds(pilot);
  const people = pilot.participants.filter(person => selected.includes(person.id));
  const observations = await db.crmPilotObservation.findMany({ where: { pilotId: id } });
  const conversationRows = observations.filter(row => row.kind === "CONVERSATION");
  const result = pilot.startedAt && people.length === 5 ? evaluateContactPilot({ pilotStarted: true, dataReviewComplete: Boolean(pilot.reviewedAt), weekStarts: [pilot.weekOne, pilot.weekTwo],
    participants: people.map(row => ({ id: row.id, suitableDays: row.suitableDays as SuitableDays })),
    conversations: conversationRows.map(row => ({ id: row.id, participantId: row.participantId, day: berlinDay(row.occurredAt), kind: row.conversationKind as "NEW_ACQUAINTANCE" | "FIRST_REFERRAL" | "EXISTING_CONTACT", conversationConfirmed: row.conversationConfirmed, resultCorrect: row.resultCorrect, nextActionRequired: row.nextActionRequired, nextActionCorrect: row.nextActionCorrect })) }, now) : null;
  const report = result ? { ...result, people: result.people.map(person => ({ ...person, id: people.find(row => row.id === person.id)?.alias ?? "Gelöschtes Konto" })) } : { denominator: pilot.startedAt ? selected.length : null, qualified: 0, fullyObserved: false, windowElapsed: berlinDay(now) >= shift(pilot.weekTwo, 7), decision: "NOT_STARTED", people: [] };
  return { pilot: view(pilot, userId), report: { ...report,
    confirmedConversationCount: conversationRows.filter(row => row.conversationConfirmed).length, correctnessSource: "USER_REVIEW_WITH_SERVER_CHECKED_CRM_PROOF", conversationSource: "PARTICIPANT_SELF_CONFIRMATION",
    uniqueFirstEncounters: uniqueFirstEncounters(conversationRows, [pilot.weekOne, pilot.weekTwo], now),
    hurdles: Object.fromEntries([...new Set(observations.map(row => row.hurdle).filter((value): value is string => Boolean(value)))].map(hurdle => [hurdle, observations.filter(row => row.hurdle === hurdle).length])),
    completedWeeklyReviews: [1, 2].map(week => observations.filter(row => row.kind === `WEEK_REVIEW_${week}`).length),
    preparationObservationCount: observations.filter(row => row.kind === "PREPARATION_HURDLE").length,
    withdrawnParticipantCount: people.filter(row => row.withdrawnAt).length,
    privacy: "Only fixed pseudonyms and counts; a deleted account remains in the frozen five-person denominator." } };
}
