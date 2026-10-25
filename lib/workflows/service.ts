import { createHash } from "node:crypto";
import type { Prisma, PrismaClient, CrmWorkTask } from "@/lib/generated/prisma/client";
import { AiCrmError } from "@/lib/ai-crm/errors";
import type { CompleteWorkTaskInput, ContactOrigin, StartWorkTaskInput, WorkTaskView } from "@/lib/workflows/contracts";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const VERSION = "contact-work-2026-10-05";
export const evidenceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function workTaskCorrectionCount(task: Pick<CrmWorkTask, "proof">): number | null {
  const proof = task.proof as Record<string, unknown> | null;
  const count = proof?.correctionCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 100 ? count : null;
}
export async function requireWorkUser(db: Pick<Db, "user"> | Tx, userId: string) {
  const user = await db.user.findFirst({ where: { id: userId, deactivatedAt: null } });
  if (!user) throw new AiCrmError("WORK_USER_UNAVAILABLE", "Bitte melde dich mit einem aktiven Konto an.", 403);
  return user;
}
async function ownContact(db: Pick<Db, "contact"> | Tx, userId: string, contactId: string) {
  const contact = await db.contact.findFirst({ where: { id: contactId, ownerId: userId } });
  if (!contact) throw new AiCrmError("WORK_CONTACT_UNAVAILABLE", "Bitte wähle einen eigenen verfügbaren Kontakt.", 404);
  return contact;
}
async function ownWorkTaskRecord(db: Db | Tx, userId: string, id: string, open = false) {
  await requireWorkUser(db, userId);
  const task = await db.crmWorkTask.findFirst({ where: { id, userId } });
  if (!task) throw new AiCrmError("WORK_TASK_NOT_FOUND", "Diese Arbeit ist nicht verfügbar.", 404);
  if (open && task.status !== "STARTED") throw new AiCrmError("WORK_TASK_FINISHED", "Diese Arbeit wurde bereits beendet.", 409);
  return task;
}
export async function ownWorkTask(db: Db | Tx, userId: string, id: string, open = false) {
  const task = await ownWorkTaskRecord(db, userId, id, open);
  await ownContact(db, userId, task.contactId);
  return task;
}
export function workTaskView(task: CrmWorkTask, attemptCount = 0): WorkTaskView {
  return { id: task.id, clientTaskId: task.clientTaskId, kind: task.kind as WorkTaskView["kind"], route: task.route as WorkTaskView["route"], contactId: task.contactId,
    status: task.status as WorkTaskView["status"], version: task.version, appVersion: task.appVersion, startedAt: task.startedAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null, reviewedAt: task.reviewedAt?.toISOString() ?? null,
    resultCorrect: task.resultCorrect, nextActionRequired: task.nextActionRequired, nextActionCorrect: task.nextActionCorrect, errorCode: task.errorCode, attemptCount, correctionCount: workTaskCorrectionCount(task) };
}
export async function startWorkTask(db: Db, userId: string, input: StartWorkTaskInput, now = new Date()) {
  await requireWorkUser(db, userId); await ownContact(db, userId, input.contactId);
  const previous = await db.crmWorkTask.findUnique({ where: { userId_clientTaskId: { userId, clientTaskId: input.clientTaskId } }, include: { _count: { select: { attempts: true } } } });
  if (previous) {
    if (previous.kind !== input.kind || previous.route !== input.route || previous.contactId !== input.contactId) throw new AiCrmError("WORK_REPLAY_CHANGED", "Die Kennung gehört zu einer anderen Arbeit.", 409);
    return workTaskView(previous, previous._count.attempts);
  }
  try {
    const task = await db.$transaction(async tx => {
      await requireWorkUser(tx, userId); await ownContact(tx, userId, input.contactId);
      return tx.crmWorkTask.create({ data: { userId, ...input, startedAt: now, appVersion: process.env.VERCEL_GIT_COMMIT_SHA || VERSION,
        attempts: { create: { requestId: `manual:${userId}:${input.clientTaskId}`, kind: "USER_STARTED", startedAt: now } } }, include: { _count: { select: { attempts: true } } } });
    });
    return workTaskView(task, task._count.attempts);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return startWorkTask(db, userId, input, now);
    throw error;
  }
}
export async function listWorkTasks(db: Db, userId: string, contactId?: string) {
  await requireWorkUser(db, userId);
  if (contactId) await ownContact(db, userId, contactId);
  const tasks = await db.crmWorkTask.findMany({ where: { userId, ...(contactId ? { contactId } : {}) }, orderBy: { startedAt: "desc" }, take: 100, include: { _count: { select: { attempts: true } } } });
  return tasks.map(task => workTaskView(task, task._count.attempts));
}
async function proofState(db: Db | Tx, userId: string, task: CrmWorkTask, now: Date) {
  const contact = await ownContact(db, userId, task.contactId);
  const activities = await db.activity.findMany({ where: { contactId: task.contactId, contact: { ownerId: userId }, createdAt: { gte: task.startedAt }, date: { lte: now }, type: { in: ["CALL", "MEETING"] } }, orderBy: { createdAt: "desc" }, take: 100 });
  const followUps = await db.contactFollowUp.findMany({ where: { contactId: task.contactId, ownerId: userId, contact: { ownerId: userId }, status: "OPEN", at: { gte: now } }, orderBy: { at: "asc" }, take: 100 });
  const revision = evidenceHash({ contactId: contact.id, updatedAt: contact.updatedAt, outcome: contact.outcome, activities: activities.map(row => [row.id, row.text, row.date, row.createdAt]), followUps: followUps.map(row => [row.id, row.updatedAt, row.at, row.type, row.note]) });
  return { contact, activities, followUps, revision };
}
export async function workTaskDetail(db: Db, userId: string, id: string, now = new Date()) {
  const task = await ownWorkTask(db, userId, id);
  const [state, count] = await Promise.all([proofState(db, userId, task, now), db.crmWorkAttempt.count({ where: { taskId: id } })]);
  const attemptIds = task.kind === "PREPARE_CONTACT" ? (await db.crmWorkAttempt.findMany({ where: { taskId: id, kind: { in: ["CHAT", "LIVE_TURN"] } }, orderBy: { startedAt: "desc" }, take: 30 })).map(row => row.requestId) : [];
  const requests = attemptIds.length ? await db.aiRequest.findMany({ where: { id: { in: attemptIds }, userId, status: "COMPLETED", expiresAt: { gt: now } }, orderBy: { startedAt: "desc" }, take: 10 }) : [];
  return { task: workTaskView(task, count), proofRevision: state.revision,
    contact: { id: state.contact.id, name: state.contact.name, outcome: state.contact.outcome, updatedAt: state.contact.updatedAt.toISOString() },
    activities: state.activities.map(row => ({ id: row.id, type: row.type, text: row.text.slice(0, 4000), date: row.date.toISOString(), createdAt: row.createdAt.toISOString() })),
    followUps: state.followUps.map(row => ({ id: row.id, type: row.type, note: row.note?.slice(0, 4000) ?? null, at: row.at.toISOString() })),
    preparationRequests: requests.flatMap(row => { const response = row.response as Record<string, unknown> | null; return typeof response?.answer === "string" && response.answer.trim() ? [{ id: row.id, answer: response.answer.slice(0, 4000), createdAt: row.startedAt.toISOString() }] : []; }) };
}
/** One provider request is one attempt; network replay is the same attempt. */
export async function bindWorkRequest(db: Db, userId: string, taskId: string, requestId: string, kind: string, now = new Date()) {
  return db.$transaction(async tx => {
    // Serialize one account's request assignment with its task completion and
    // provider reservation, then keep existing usage bindings stable.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.crmWorkAttempt.findUnique({ where: { requestId } });
    const task = await ownWorkTask(tx, userId, taskId, !existing);
    if (task.route === "MANUAL") throw new AiCrmError("WORK_ROUTE_MANUAL", "Wähle für Jarvis zuerst den gemischten Weg.", 409);
    const request = await tx.aiRequest.findFirst({ where: { id: requestId, userId } });
    if (!request) throw new AiCrmError("WORK_REQUEST_UNAVAILABLE", "Diese Anfrage ist nicht verfügbar.", 404);
    if (existing && existing.taskId !== taskId) throw new AiCrmError("WORK_ATTEMPT_REBOUND", "Die Anfrage gehört bereits zu einer anderen Arbeit.", 409);
    await tx.$queryRaw`SELECT "id" FROM "AiUsage" WHERE "userId" = ${userId} AND "requestId" = ${requestId} FOR UPDATE`;
    const differentlyBoundUsage = await tx.aiUsage.findFirst({ where: { userId, requestId, workTaskId: { not: taskId } }, select: { id: true } });
    if (differentlyBoundUsage) throw new AiCrmError("WORK_USAGE_REBOUND", "Die Kosten dieser Anfrage gehören bereits zu einer anderen Arbeit.", 409);
    await tx.crmWorkAttempt.upsert({ where: { requestId }, create: { requestId, taskId, kind, startedAt: now }, update: {} });
    await tx.aiUsage.updateMany({ where: { userId, requestId, OR: [{ workTaskId: null }, { workTaskId: taskId }] }, data: { workTaskId: taskId } });
    return task;
  });
}
export async function validateAiWorkTask(db: Db, userId: string, taskId: string, contactId?: string, open = false) {
  const task = await ownWorkTask(db, userId, taskId, open);
  if (task.route === "MANUAL") throw new AiCrmError("WORK_ROUTE_MANUAL", "Wähle für Jarvis zuerst den gemischten Weg.", 409);
  if (contactId && contactId !== task.contactId) throw new AiCrmError("WORK_CONTEXT_CHANGED", "Wähle den Kontakt dieser Arbeit oder starte eine neue Arbeit.", 409);
  return task;
}
export async function bindWorkUsage(db: Db, userId: string, taskId: string, usageId: string) {
  await ownWorkTask(db, userId, taskId, true);
  const changed = await db.aiUsage.updateMany({ where: { id: usageId, userId, OR: [{ workTaskId: null }, { workTaskId: taskId }] }, data: { workTaskId: taskId } });
  if (!changed.count) throw new AiCrmError("WORK_USAGE_UNAVAILABLE", "Die Kostenmessung konnte nicht zugeordnet werden.", 409);
}
export async function bindWorkSession(db: Db, userId: string, taskId: string, sessionId: string, now = new Date()) {
  await validateAiWorkTask(db, userId, taskId, undefined, true);
  const session = await db.aiLiveSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw new AiCrmError("WORK_SESSION_UNAVAILABLE", "Die Sprachrunde ist nicht verfügbar.", 404);
  const requestId = `live:${session.id}`;
  const existing = await db.crmWorkAttempt.findUnique({ where: { requestId } });
  if (existing && existing.taskId !== taskId) throw new AiCrmError("WORK_ATTEMPT_REBOUND", "Diese Sprachrunde gehört bereits zu einer anderen Arbeit.", 409);
  await db.crmWorkAttempt.upsert({ where: { requestId }, create: { taskId, requestId, kind: "LIVE_SESSION", startedAt: now }, update: {} });
}
export async function changeWorkRoute(db: Db, userId: string, id: string, version: number) {
  const task = await ownWorkTask(db, userId, id, true);
  if (task.route === "MIXED" && (task.version === version || task.version === version + 1)) return workTaskView(task, await db.crmWorkAttempt.count({ where: { taskId: id } }));
  const changed = await db.crmWorkTask.updateMany({ where: { id, userId, status: "STARTED", version }, data: { route: "MIXED", version: { increment: 1 } } });
  if (!changed.count) throw new AiCrmError("WORK_CHANGED", "Die Arbeit hat sich geändert. Bitte lade sie erneut.", 409);
  return (await workTaskDetail(db, userId, id)).task;
}
export async function completeWorkTask(db: Db, userId: string, id: string, input: CompleteWorkTaskInput, now = new Date()) {
  if (input.resultCorrect !== true) throw new AiCrmError("WORK_CORRECTNESS_REQUIRED", "Bestätige ausdrücklich das fachlich korrekte Ergebnis.", 400);
  const correctionCount = input.correctionCount ?? null;
  if (correctionCount !== null && (!Number.isInteger(correctionCount) || correctionCount < 0 || correctionCount > 100)) throw new AiCrmError("WORK_CORRECTION_COUNT_INVALID", "Die Zahl fachlich nötiger Korrekturen muss zwischen 0 und 100 liegen oder unbekannt bleiben.", 400);
  const completed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const task = await ownWorkTask(tx, userId, id);
    await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${task.contactId} FOR SHARE`;
    if (task.status === "COMPLETED") {
      const proof = task.proof as Record<string, unknown> | null;
      if (task.version === input.version + 1 && proof?.revision === input.proofRevision && proof?.activityId === (input.activityId ?? null) && proof?.preparationRequestId === (input.preparationRequestId ?? null) && task.nextActionRequired === input.nextActionRequired && proof?.followUpId === (input.followUpId ?? null) && workTaskCorrectionCount(task) === correctionCount) return task;
      throw new AiCrmError("WORK_TASK_FINISHED", "Diese Arbeit wurde bereits anders beendet.", 409);
    }
    if (task.status !== "STARTED" || task.version !== input.version) throw new AiCrmError("WORK_CHANGED", "Die Arbeit hat sich geändert. Bitte lade sie erneut.", 409);
    const state = await proofState(tx, userId, task, now);
    if (state.revision !== input.proofRevision) throw new AiCrmError("WORK_PROOF_CHANGED", "Der Kontakt oder das Ergebnis hat sich geändert. Bitte prüfe den aktuellen Stand.", 409);
    let activity = null;
    if (task.kind === "RECORD_CONVERSATION") {
      activity = state.activities.find(row => row.id === input.activityId);
      if (!activity?.text.trim()) throw new AiCrmError("WORK_RESULT_REQUIRED", "Wähle ein seit Arbeitsbeginn dokumentiertes Gesprächsergebnis.", 400);
      await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${activity.id} FOR SHARE`;
      const reused = await tx.crmWorkTask.findFirst({ where: { userId, id: { not: id }, kind: "RECORD_CONVERSATION", status: "COMPLETED", proof: { path: ["activityId"], equals: activity.id } } });
      if (reused) throw new AiCrmError("WORK_RESULT_ALREADY_USED", "Dieses Ergebnis gehört bereits zu einer abgeschlossenen Arbeit.", 409);
    } else {
      if (input.activityId || input.nextActionRequired || input.followUpId) throw new AiCrmError("WORK_PREPARATION_ONLY", "Eine Vorbereitung bestätigt die brauchbare Vorbereitung; sie zählt kein Gespräch.", 400);
      if (task.route === "JARVIS" && !input.preparationRequestId) throw new AiCrmError("WORK_PREPARATION_REQUIRED", "Wähle die Jarvis-Antwort dieser Arbeit.", 400);
      if (input.preparationRequestId) {
        const attempt = await tx.crmWorkAttempt.findFirst({ where: { taskId: id, requestId: input.preparationRequestId } });
        const request = await tx.aiRequest.findFirst({ where: { id: input.preparationRequestId, userId, status: "COMPLETED", expiresAt: { gt: now } } });
        const response = request?.response as Record<string, unknown> | null;
        if (!attempt || !request || typeof response?.answer !== "string" || !response.answer.trim()) throw new AiCrmError("WORK_PREPARATION_REQUIRED", "Die bestätigte Jarvis-Antwort ist nicht verfügbar.", 400);
      }
    }
    const followUp = input.nextActionRequired ? state.followUps.find(row => row.id === input.followUpId) : null;
    if (followUp) await tx.$queryRaw`SELECT "id" FROM "ContactFollowUp" WHERE "id" = ${followUp.id} FOR SHARE`;
    if (input.nextActionRequired && (!followUp || state.contact.outcome === "VERLOREN")) throw new AiCrmError("WORK_NEXT_ACTION_REQUIRED", "Wähle eine aktuelle eigene nächste Handlung. Ein abgeschlossenes negatives Ergebnis benötigt keine künstliche Wiedervorlage.", 400);
    if (!input.nextActionRequired && input.followUpId) throw new AiCrmError("WORK_NEXT_ACTION_UNUSED", "Ohne erforderliche nächste Handlung wird keine Wiedervorlage bestätigt.", 400);
    if ((await proofState(tx, userId, task, now)).revision !== input.proofRevision) throw new AiCrmError("WORK_PROOF_CHANGED", "Der gespeicherte Beleg hat sich während der Prüfung geändert.", 409);
    const proof = { revision: state.revision, contactUpdatedAt: state.contact.updatedAt.toISOString(), activityId: activity?.id ?? null, activityDate: activity?.date.toISOString() ?? null,
      activityHash: activity ? evidenceHash([activity.id, activity.text, activity.type, activity.date, activity.createdAt]) : null,
      followUpId: followUp?.id ?? null, followUpHash: followUp ? evidenceHash([followUp.id, followUp.type, followUp.at, followUp.note, followUp.updatedAt]) : null,
      preparationRequestId: input.preparationRequestId ?? null, correctionCount, correctionSource: correctionCount === null ? "UNKNOWN" : "EXPLICIT_USER_REVIEW", confirmationSource: "USER_REVIEW" };
    const changed = await tx.crmWorkTask.updateMany({ where: { id, userId, status: "STARTED", version: input.version }, data: { status: "COMPLETED", finishedAt: now, reviewedAt: now,
      resultCorrect: true, nextActionRequired: input.nextActionRequired, nextActionCorrect: !input.nextActionRequired || Boolean(followUp), proof, version: { increment: 1 } } });
    if (!changed.count) throw new AiCrmError("WORK_CHANGED", "Die Arbeit hat sich geändert. Bitte lade sie erneut.", 409);
    return tx.crmWorkTask.findUniqueOrThrow({ where: { id } });
  });
  return workTaskView(completed, await db.crmWorkAttempt.count({ where: { taskId: id } }));
}
export async function finishWorkTask(db: Db, userId: string, id: string, input: { version: number; status: "CANCELED" | "FAILED"; errorCode?: string }, now = new Date()) {
  const task = await ownWorkTaskRecord(db, userId, id);
  if (task.status === input.status && task.version === input.version + 1 && task.errorCode === (input.errorCode ?? null)) return workTaskView(task, await db.crmWorkAttempt.count({ where: { taskId: id } }));
  if (input.status === "FAILED" && !input.errorCode) throw new AiCrmError("WORK_ERROR_REQUIRED", "Wähle den Grund des fehlgeschlagenen Versuchs.", 400);
  const changed = await db.crmWorkTask.updateMany({ where: { id, userId, status: "STARTED", version: input.version }, data: { status: input.status, finishedAt: now, errorCode: input.errorCode ?? null, resultCorrect: false, version: { increment: 1 } } });
  if (!changed.count) throw new AiCrmError("WORK_CHANGED", "Die Arbeit hat sich geändert. Bitte lade sie erneut.", 409);
  return workTaskView(await db.crmWorkTask.findUniqueOrThrow({ where: { id } }), await db.crmWorkAttempt.count({ where: { taskId: id } }));
}
export async function registerContactCohort(db: Db, userId: string, contactId: string, origin: ContactOrigin) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    await requireWorkUser(tx, userId);
    await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${contactId} FOR SHARE`;
    const contact = await ownContact(tx, userId, contactId);
    const eligible = ["NEW_ACQUAINTANCE", "FIRST_REFERRAL", "EXISTING_CONTACT"].includes(origin);
    const existing = await tx.crmContactCohort.findUnique({ where: { userId_contactId: { userId, contactId } } });
    if (existing) { if (existing.origin !== origin) throw new AiCrmError("COHORT_FROZEN", "Die ursprüngliche Einschlussentscheidung bleibt erhalten.", 409); return existing; }
    return tx.crmContactCohort.create({ data: { userId, contactId, origin, eligible, exclusionReason: eligible ? null : origin, registeredAt: contact.createdAt } });
  });
}
export async function contactCohortForUser(db: Db, userId: string, contactId: string) {
  await requireWorkUser(db, userId); await ownContact(db, userId, contactId);
  const row = await db.crmContactCohort.findUnique({ where: { userId_contactId: { userId, contactId } } });
  return row ? { origin: row.origin, registeredAt: row.registeredAt.toISOString(), firstConfirmedContactAt: row.firstConfirmedContactAt?.toISOString() ?? null, eligible: row.eligible } : null;
}

/** Rechecks current source ownership/content. It does not infer a real conversation. */
export async function completedConversationProof(db: Db | Tx, userId: string, taskId: string) {
  const task = await ownWorkTask(db, userId, taskId);
  const proof = task.proof as Record<string, unknown> | null;
  if (task.kind !== "RECORD_CONVERSATION" || task.status !== "COMPLETED" || !task.resultCorrect || !task.reviewedAt || typeof proof?.activityId !== "string") throw new AiCrmError("WORK_CONFIRMATION_REQUIRED", "Bestätige zuerst das korrekt gespeicherte Gesprächsergebnis.", 400);
  await db.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${task.contactId} FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${proof.activityId} FOR SHARE`;
  const activity = await db.activity.findFirst({ where: { id: proof.activityId, contactId: task.contactId, contact: { ownerId: userId } } });
  if (!activity || proof.activityHash !== evidenceHash([activity.id, activity.text, activity.type, activity.date, activity.createdAt])) throw new AiCrmError("WORK_PROOF_CHANGED", "Der gespeicherte Gesprächsbeleg ist nicht mehr unverändert verfügbar.", 409);
  if (task.nextActionRequired) {
    if (typeof proof.followUpId === "string") await db.$queryRaw`SELECT "id" FROM "ContactFollowUp" WHERE "id" = ${proof.followUpId} FOR SHARE`;
    const followUp = typeof proof.followUpId === "string" ? await db.contactFollowUp.findFirst({ where: { id: proof.followUpId, contactId: task.contactId, ownerId: userId, contact: { ownerId: userId }, status: "OPEN" } }) : null;
    if (!followUp || proof.followUpHash !== evidenceHash([followUp.id, followUp.type, followUp.at, followUp.note, followUp.updatedAt])) throw new AiCrmError("WORK_PROOF_CHANGED", "Die bestätigte nächste Handlung hat sich geändert.", 409);
  }
  return { task, activity };
}
export async function confirmFirstContact(db: Db, userId: string, taskId: string, now = new Date()) {
  return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const { task, activity } = await completedConversationProof(tx, userId, taskId);
  if (activity.date > now) throw new AiCrmError("WORK_FUTURE_CONVERSATION", "Ein zukünftiges Gespräch kann noch nicht bestätigt werden.", 400);
  const cohort = await tx.crmContactCohort.findUnique({ where: { userId_contactId: { userId, contactId: task.contactId } } });
  if (!cohort?.eligible) throw new AiCrmError("COHORT_REQUIRED", "Ordne den Kontakt zuerst der festgelegten Kontaktkohorte zu.", 400);
  if (activity.date < cohort.registeredAt) throw new AiCrmError("COHORT_CONTACT_BEFORE_CAPTURE", "Die bestätigte erste Kontaktaufnahme liegt vor der Erfassung.", 400);
  await tx.crmContactCohort.updateMany({ where: { id: cohort.id, OR: [{ firstConfirmedContactAt: null }, { firstConfirmedContactAt: { gt: activity.date } }] }, data: { firstConfirmedContactAt: activity.date } });
  return tx.crmContactCohort.findUniqueOrThrow({ where: { id: cohort.id } });
  });
}
