import { describeWorkOperation, parseOperation, workActor } from "@/lib/ai-crm/work-registry";
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client";
import { AiCrmError, safeAiMessage } from "@/lib/ai-crm/errors";
import { hashAiRequestInput } from "@/lib/ai-crm/requests";
import { parseTool, runCrmTool, WRITE_TOOLS, type CrmToolResult } from "@/lib/ai-crm/tools";
import { UNDO_WINDOW_SECONDS } from "@/lib/undo-window";
import type { ActionReceipt, AssistantContext, PlanField } from "@/lib/ai-crm/contracts";
import { aiUndoState, sameAiUndoState, type AiUndoGuard } from "@/lib/ai-crm/undo-guard";
import { LEADERSHIP_SCHEMAS, describeLeadershipPlan, lockLeadershipPlan, resolveLeadershipPartner, readLeadershipSource } from "@/lib/ai-crm/leadership-tools";
import { leadershipScopeFingerprint } from "@/lib/ai-crm/leadership-scope";
import { berlinLocalToUtc, utcToBerlinLocalInput } from "@/lib/dates";
import { assertExecutionAllowed } from "@/lib/ai-crm/execution-policy";

type Db = PrismaClient | Prisma.TransactionClient;
type Plan = {
  version: 1;
  name: string;
  args: Record<string, unknown>;
  expected: Record<string, unknown>;
  receipt: ActionReceipt;
  dependsOn?: string;
};
type Stored = CrmToolResult & { plan?: Plan; error?: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const format = (value: unknown) => value == null || value === "" ? "Nicht angegeben" : String(value);
const date = (value: unknown) => new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(String(value)));
const labels: Record<string, string> = { name: "Name", phone: "Telefonnummer", email: "E-Mail", source: "Herkunft", job: "Beruf" };
const followUpLabels: Record<string, string> = { ANRUF: "Anruf", TERMIN: "Termin", NACHFASSEN: "Nachfassen", EMPFEHLUNG_ERFRAGEN: "Empfehlung erfragen", SONSTIGES: "Sonstiges" };

export async function resolveAssistantContext(db: Db, userId: string, context: Omit<AssistantContext, "label">) {
  if (!context.contactId && !context.partnerId && context.entityType === "appointment" && context.entityId) {
    const appointment = await readLeadershipSource(db, userId, "appointment", context.entityId);
    return { attachment: { ...context, label: "titel" in appointment ? appointment.titel : "Eigener Termin" } satisfies AssistantContext };
  }
  if (context.partnerId && !context.contactId) {
    const partner = await resolveLeadershipPartner(db, userId, context.partnerId);
    if (context.entityType && context.entityId) {
      const source = await readLeadershipSource(db, userId, context.entityType, context.entityId);
      const sourcePartner = "partnerId" in source ? source.partnerId : "memberId" in source ? source.memberId : "partner" in source ? source.partner.id : null;
      if (sourcePartner && sourcePartner !== partner.id) throw new AiCrmError("CONTEXT_MISMATCH", "Der Eintrag gehört zu einem anderen Partner. Bitte wähle ihn erneut.", 409);
    }
    return { attachment: { ...context, label: partner.name } satisfies AssistantContext };
  }
  if (!context.contactId || context.partnerId) throw new AiCrmError("INVALID_CONTEXT", "Bitte wähle einen eindeutigen Bezug.");
  const contact = await db.contact.findFirst({ where: { id: context.contactId, ownerId: userId } });
  if (!contact) throw new AiCrmError("CONTACT_NOT_FOUND", "Diesen Kontakt kann ich in deinen eigenen CRM-Daten nicht öffnen.", 404);
  const followUp = context.followUpId ? await db.contactFollowUp.findFirst({ where: { id: context.followUpId, contactId: contact.id, ownerId: userId } }) : null;
  if (context.followUpId && !followUp) throw new AiCrmError("FOLLOW_UP_NOT_FOUND", "Diese Wiedervorlage ist nicht verfügbar.", 404);
  return { contact, followUp, attachment: { contactId: contact.id, label: contact.name, ...(followUp ? { followUpId: followUp.id } : {}) } satisfies AssistantContext };
}

async function describePlan(db: Db, userId: string, name: string, args: Record<string, unknown>, proposedContact?: Record<string, unknown>): Promise<Plan> {
  if (name === "execute_crm_operation") return { version: 1, name, args, ...await describeWorkOperation(db, userId, args) };
  if (Object.hasOwn(LEADERSHIP_SCHEMAS, name)) {
    const described = await describeLeadershipPlan(db, userId, name, args);
    return { version: 1, name, args, ...described };
  }
  let contactId = args.contactId as string | undefined;
  const followUp = name === "complete_follow_up" ? await db.contactFollowUp.findFirst({ where: { id: String(args.followUpId), ownerId: userId, contact: { ownerId: userId } } }) : null;
  if (name === "complete_follow_up" && (!followUp || followUp.status !== "OPEN")) throw new AiCrmError("FOLLOW_UP_NOT_FOUND", "Diese offene Wiedervorlage ist nicht verfügbar.", 404);
  if (followUp) contactId = followUp.contactId;
  const contact = proposedContact ?? (contactId ? await db.contact.findFirst({ where: { id: contactId, ownerId: userId } }) : null);
  if (name !== "create_contact" && !contact) throw new AiCrmError("CONTACT_NOT_FOUND", "Diesen Kontakt kann ich in deinen eigenen CRM-Daten nicht öffnen.", 404);
  const expected: Record<string, unknown> = {};
  const receipt: ActionReceipt = { summary: "Änderung prüfen", contactName: String(contact?.name ?? args.name), status: "PENDING", undoable: false, link: contact && !proposedContact ? `/contacts/${contact.id}` : undefined, details: [] };
  if (contact) { expected.contactId = contact.id; expected.name = contact.name; }
  switch (name) {
    case "create_contact":
      receipt.summary = "Kontakt anlegen"; receipt.confirmLabel = "Kontakt anlegen";
      receipt.details = [String(args.name), ...["phone", "email", "source", "job", "note"].filter(field => args[field]).map(field => `${labels[field] ?? "Notiz"}: ${args[field]}`), "Mit erstem Anrufschritt und Eintrag in deiner Aktivität."];
      break;
    case "update_contact": {
      receipt.summary = "Kontaktdaten ändern";
      const fields = [...new Set(args.changeFields as string[])];
      receipt.confirmLabel = fields.length === 1 ? `${labels[fields[0]]} ändern` : "Änderungen speichern";
      receipt.changes = fields.map(field => {
        const before = (contact as unknown as Record<string, unknown>)[field];
        expected[field] = before;
        return { label: labels[field], before: format(before), after: format(args[field]) };
      });
      break;
    }
    case "add_note":
      expected.note = contact!.note; receipt.summary = "Notiz ergänzen"; receipt.confirmLabel = "Notiz speichern"; receipt.details = [String(args.text)]; break;
    case "add_activity":
      receipt.summary = "Gespräch dokumentieren"; receipt.confirmLabel = "Gespräch speichern"; receipt.details = [args.type === "CALL" ? "Telefonat" : args.type === "MEETING" ? "Termin" : "E-Mail", String(args.text), args.occurredAt ? date(args.occurredAt) : "Jetzt"]; break;
    case "create_follow_up":
      receipt.summary = "Wiedervorlage anlegen"; receipt.confirmLabel = "Wiedervorlage speichern"; receipt.details = [followUpLabels[String(args.type)], date(args.at), String(args.note)]; break;
    case "complete_follow_up":
      expected.followUp = { id: followUp!.id, at: followUp!.at.toISOString(), note: followUp!.note, type: followUp!.type, status: followUp!.status };
      receipt.summary = "Wiedervorlage erledigen"; receipt.confirmLabel = "Als erledigt markieren"; receipt.details = [followUpLabels[followUp!.type], date(followUp!.at), followUp!.note ?? "Wiedervorlage", "Für das Erledigen ist keine Rücknahme verfügbar."]; break;
  }
  return { version: 1, name, args, expected, receipt };
}

/** Language never authorizes a business mutation, including short commands. */
export function permitsDirectAction(_message: string, _tool: string, _actionCount: number) {
  void _message; void _tool; void _actionCount;
  return false;
}

const editableLabels: Record<string, string> = { text: "Gesprächsnotiz", title: "Inhalt", titel: "Inhalt", note: "Notiz / Herkunft", at: "Fällig am (Berliner Zeit)", dueAt: "Fällig am (Berliner Zeit)", occurredAt: "Gespräch am (Berliner Zeit)", faelligAm: "Fällig am (Berliner Zeit)", endetAm: "Ende (Berliner Zeit)", start: "Beginn (Berliner Zeit)", end: "Ende (Berliner Zeit)", startAt: "Beginn (Berliner Zeit)", endAt: "Ende (Berliner Zeit)", von: "Beginn (Berliner Zeit)", bis: "Ende (Berliner Zeit)", location: "Ort", ort: "Ort" };
const editableDates = new Set(["at", "dueAt", "occurredAt", "faelligAm", "endetAm", "start", "end", "startAt", "endAt", "von", "bis"]);
function editableFields(plan: Plan): PlanField[] {
  if (plan.name === "execute_crm_operation") return (plan.args.fields as Array<{ name: string; value: string }>).filter(field => !/Id$|^ids$|^id$|^name$/.test(field.name)).map(field => ({ ...field, label: editableLabels[field.name] ?? field.name, type: "text" as const }));
  const fieldLabels = plan.name === "create_contact" || plan.name === "update_contact" ? { ...editableLabels, ...labels } : editableLabels;
  const fields: PlanField[] = Object.entries(plan.args).filter(([key, value]) => fieldLabels[key] && (typeof value === "string" || value === null) && (plan.name !== "update_contact" || (plan.args.changeFields as string[]).includes(key))).map(([name, value]) => ({ name, value: value == null ? "" : editableDates.has(name) ? utcToBerlinLocalInput(new Date(String(value))) : String(value), label: fieldLabels[name], type: editableDates.has(name) ? "datetime" : "text" }));
  if (typeof plan.args.responsibleId === "string") {
    const scope = plan.expected.scope as { userId?: string; partnerId?: string; initiator?: { userId: string }; receiver?: { userId: string } };
    const ids = [scope?.userId, scope?.partnerId, scope?.initiator?.userId, scope?.receiver?.userId].filter((id): id is string => Boolean(id));
    fields.push({ name: "responsibleId", label: "Verantwortliche Person", value: plan.args.responsibleId, type: "select", options: [...new Set(ids)].map(value => ({ value, label: value === scope?.partnerId ? plan.receipt.contactName ?? "Partner" : value === scope?.userId ? "Ich selbst" : value === plan.args.responsibleId ? "Bisher verantwortlich" : "Andere beteiligte Person" })) });
  }
  return fields;
}
function editedValue(plan: Plan, key: string, value: string) {
  if (value === "" && plan.args[key] === null) return null;
  // Spoken corrections can supply an explicit offset. Visible date controls
  // supply Berlin wall time, independent of the browser/server time zone.
  if (!editableDates.has(key) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const instant = berlinLocalToUtc(value);
  if (!instant || utcToBerlinLocalInput(instant) !== value) throw new AiCrmError("INVALID_EDIT", "Diese Uhrzeit gibt es im Berliner Kalender nicht. Bitte prüfe Datum und Zeitumstellung.");
  const ambiguous = [-3600000, 3600000].some(delta => utcToBerlinLocalInput(new Date(instant.getTime() + delta)) === value);
  if (ambiguous) throw new AiCrmError("INVALID_EDIT", "Diese Uhrzeit kommt bei der Zeitumstellung zweimal vor. Bitte nenne für die Korrektur ausdrücklich Sommerzeit oder Winterzeit, oder wähle eine andere Uhrzeit.");
  return instant.toISOString();
}
const planRevision = (plan: Plan) => hashAiRequestInput({ name: plan.name, args: plan.args, expected: plan.expected });
async function cancelDependents(db: Db, userId: string, requestId: string, parentIds: string[]) {
  const pending = await db.aiToolExecution.findMany({ where: { userId, requestId, status: "PENDING" }, select: { id: true, result: true } });
  const canceled = new Set(parentIds);
  for (let pass = 0; pass < pending.length; pass++) for (const row of pending) {
    const dependency = (row.result as unknown as Stored | null)?.plan?.dependsOn;
    if (dependency && canceled.has(dependency)) canceled.add(row.id);
  }
  await db.aiToolExecution.updateMany({ where: { userId, requestId, id: { in: [...canceled] }, status: "PENDING" }, data: { status: "CANCELED" } });
}

export async function stageAction(db: PrismaClient, params: { userId: string; requestId: string; name: string; arguments: unknown; key: string }) {
  const parsed = parseTool(params.name, params.arguments);
  if (!WRITE_TOOLS.has(parsed.name)) throw new AiCrmError("INVALID_TOOL", "Diese Aktion verändert keine CRM-Daten.");
  return db.$transaction(async tx => {
    await assertExecutionAllowed(tx, params.userId, params.requestId, false);
    await tx.$queryRaw`SELECT "id" FROM "AiRequest" WHERE "id" = ${params.requestId} AND "userId" = ${params.userId} FOR UPDATE`;
    const request = await tx.aiRequest.findFirst({ where: { id: params.requestId, userId: params.userId, status: "IN_PROGRESS", expiresAt: { gt: new Date() } } });
    if (!request) throw new AiCrmError("REQUEST_ABORTED", "Die Anfrage wurde beendet.", 409);
    let plan: Plan;
    const reference = typeof parsed.args.contactId === "string" && parsed.args.contactId.startsWith("pending:") ? parsed.args.contactId.slice(8) : null;
    if (reference) {
      if (!["add_note", "add_activity", "create_follow_up", "update_contact"].includes(parsed.name)) throw new AiCrmError("INVALID_DEPENDENCY", "Diese Folgeaktion braucht einen bestehenden Kontakt.");
      const parent = await tx.aiToolExecution.findFirst({ where: { id: reference, userId: params.userId, requestId: params.requestId, status: "PENDING" } });
      const parentPlan = (parent?.result as unknown as Stored)?.plan;
      if (!parentPlan || parentPlan.name !== "create_contact") throw new AiCrmError("INVALID_DEPENDENCY", "Die vorgeschaltete Kontaktanlage ist nicht verfügbar.");
      plan = await describePlan(tx, params.userId, parsed.name, parsed.args, { ...parentPlan.args, id: parsed.args.contactId });
      plan.dependsOn = reference;
      plan.receipt.details = [...(plan.receipt.details ?? []), "Wird nach der oben vorgeschlagenen Kontaktanlage ausgeführt."];
    } else plan = await describePlan(tx, params.userId, parsed.name, parsed.args);
    return tx.aiToolExecution.upsert({
      where: { userId_idempotencyKey: { userId: params.userId, idempotencyKey: params.key } },
      create: { userId: params.userId, requestId: params.requestId, tool: params.name, idempotencyKey: params.key, status: "PENDING", result: json({ plan }) },
      update: {},
    });
  });
}

export async function actionReceipts(db: Db, userId: string, requestId: string): Promise<ActionReceipt[]> {
  const executions = await db.aiToolExecution.findMany({ where: { userId, requestId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { request: { select: { expiresAt: true } } } });
  const receipts = executions.map(execution => {
    const stored = execution.result as unknown as Stored | null;
    const plan = stored?.plan;
    const base = plan?.receipt ?? stored;
    if (!base?.summary) return null;
    return { ...base, ...(plan ? { revision: planRevision(plan), fields: execution.status === "PENDING" ? editableFields(plan) : undefined } : {}), ...(execution.status === "COMPLETED" ? { summary: stored!.summary, entityType: stored!.entityType, entityId: stored!.entityId, link: stored!.link, undoable: stored!.undoable === true, undoEntryId: stored!.undoEntryId } : {}), id: execution.id, requestId, status: execution.status === "PENDING" && execution.request.expiresAt <= new Date() ? "EXPIRED" : execution.status, error: stored?.error } as ActionReceipt;
  }).filter((receipt): receipt is ActionReceipt => receipt !== null);
  return hydrateUndo(db, userId, receipts);
}

/** Failed/canceled requests can have private preview details even without a
 * persisted response. Check source access separately from mutable versions. */
export async function actionPlansAccessible(db: Db, userId: string, requestId: string) {
  const executions = await db.aiToolExecution.findMany({ where: { userId, requestId }, select: { result: true, status: true } });
  for (const execution of executions) {
    const plan = (execution.result as unknown as Stored | null)?.plan;
    if (!plan) continue;
    if (plan.name === "execute_crm_operation") {
      try {
        const actor = await workActor(db, userId);
        const { definition, operation } = parseOperation(plan.args);
        if (definition.admin && actor.role !== "ADMIN") return false;
        const subject = plan.expected.subject as { ownerId?: string; userId?: string; inhaberId?: string } | undefined;
        const deletedOwnRecord = execution.status === "COMPLETED" && operation.startsWith("delete_") && [subject?.ownerId, subject?.userId, subject?.inhaberId].includes(userId);
        if (!deletedOwnRecord) await describeWorkOperation(db, userId, plan.args);
      } catch { return false; }
      continue;
    }
    if (!Object.hasOwn(LEADERSHIP_SCHEMAS, plan.name)) continue;
    try {
      if (plan.args.partnerId) await resolveLeadershipPartner(db, userId, String(plan.args.partnerId));
      for (const [key, kind] of [["taskId", "task"], ["agreementId", "agreement"], ["sourceNoteId", "note"], ["appointmentId", "appointment"]] as const) {
        if (plan.args[key]) await readLeadershipSource(db, userId, kind, String(plan.args[key]));
      }
    } catch { return false; }
  }
  return true;
}

/** Keep rejected model writes visible without trusting their proposed contact IDs. */
export async function recordFailedAction(db: PrismaClient, params: { userId: string; requestId: string; name: string; key: string; error: unknown }) {
  const summaries: Record<string, string> = { create_contact: "Kontakt anlegen", update_contact: "Kontaktdaten ändern", add_note: "Notiz ergänzen", add_activity: "Gespräch dokumentieren", create_follow_up: "Wiedervorlage anlegen", complete_follow_up: "Wiedervorlage erledigen" };
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "AiRequest" WHERE "id" = ${params.requestId} AND "userId" = ${params.userId} FOR UPDATE`;
    const request = await tx.aiRequest.findFirst({ where: { id: params.requestId, userId: params.userId, status: "IN_PROGRESS", expiresAt: { gt: new Date() } } });
    if (!request) throw new AiCrmError("REQUEST_ABORTED", "Die Anfrage wurde beendet.", 409);
    await tx.aiToolExecution.upsert({ where: { userId_idempotencyKey: { userId: params.userId, idempotencyKey: params.key } }, create: { userId: params.userId, requestId: params.requestId, tool: params.name, idempotencyKey: params.key, status: "FAILED", result: json({ summary: summaries[params.name] ?? "Änderung vorbereiten", undoable: false, error: safeAiMessage(params.error) }) }, update: {} });
  });
}

export async function hydrateUndo(db: Db, userId: string, receipts: ActionReceipt[]): Promise<ActionReceipt[]> {
  const ids = receipts.flatMap(receipt => receipt.undoEntryId ? [receipt.undoEntryId] : []);
  const entries = ids.length ? await db.undoEntry.findMany({ where: { id: { in: ids }, userId } }) : [];
  return Promise.all(receipts.map(async receipt => {
    const undo = entries.find(entry => entry.id === receipt.undoEntryId);
    const expiresAt = undo ? new Date(undo.createdAt.getTime() + UNDO_WINDOW_SECONDS * 1000) : null;
    let status: ActionReceipt["undoStatus"] = !undo ? "UNAVAILABLE" : undo.undoneAt ? "UNDONE" : expiresAt! <= new Date() ? "EXPIRED" : "AVAILABLE";
    const patch = undo?.patch as unknown as { aiGuard?: AiUndoGuard; contactId?: string } | undefined;
    if (status === "AVAILABLE" && patch?.aiGuard && patch.contactId && !sameAiUndoState(await aiUndoState(db, userId, patch.contactId, patch.aiGuard), patch.aiGuard.state)) status = "CONFLICT";
    return { ...receipt, undoable: status === "AVAILABLE", undoStatus: status, undoExpiresAt: expiresAt?.toISOString() };
  }));
}

export async function executeActionPlan(db: PrismaClient, params: { userId: string; requestId: string; actionIds: string[]; revisions?: Record<string, string>; direct?: boolean }) {
  // Rebase only changes made by earlier actions in this exact confirmation batch.
  // The next transaction must still match the recorded post-write state.
  const changedSubjects = new Map<string, unknown>();
  for (const id of params.actionIds) {
    const afterCommit: Array<() => Promise<unknown>> = [];
    try {
      await db.$transaction(async tx => {
        await assertExecutionAllowed(tx, params.userId, params.requestId, params.direct === true);
        // Same lock order for confirmation, cancellation and deletion.
        await tx.$queryRaw`SELECT "id" FROM "AiRequest" WHERE "id" = ${params.requestId} AND "userId" = ${params.userId} FOR UPDATE`;
        const request = await tx.aiRequest.findFirst({ where: { id: params.requestId, userId: params.userId, expiresAt: { gt: new Date() }, status: params.direct ? "IN_PROGRESS" : "COMPLETED", conversation: { expiresAt: { gt: new Date() } } } });
        if (!request) throw new AiCrmError("PLAN_UNAVAILABLE", "Diese Vorschau ist nicht mehr verfügbar. Bitte frage erneut.", 409);
        const execution = await tx.aiToolExecution.findFirst({ where: { id, userId: params.userId, requestId: params.requestId } });
        if (!execution) throw new AiCrmError("PLAN_NOT_FOUND", "Diese Vorschau wurde nicht gefunden.", 404);
        if (execution.status !== "PENDING") return;
        const stored = execution.result as unknown as Stored;
        const plan = stored.plan;
        if (!plan || plan.version !== 1) throw new AiCrmError("PLAN_UNAVAILABLE", "Bitte bereite diese Änderung erneut vor.", 409);
        if (params.revisions && params.revisions[id] !== planRevision(plan)) throw new AiCrmError("PLAN_STALE", "Die Vorschau wurde bearbeitet. Bitte prüfe den aktuellen Stand.", 409);
        let resolvedArgs = plan.args;
        if (plan.dependsOn) {
          const parent = await tx.aiToolExecution.findFirst({ where: { id: plan.dependsOn, requestId: params.requestId, userId: params.userId, status: "COMPLETED" } });
          const result = parent?.result as unknown as Stored | null;
          if (!result?.entityId || result.entityType !== "Contact") throw new AiCrmError("DEPENDENCY_PENDING", "Bestätige zuerst die dazugehörige Kontaktanlage. Diese Folgeaktion bleibt offen.", 409);
          resolvedArgs = { ...plan.args, contactId: result.entityId };
        }
        if (Object.hasOwn(LEADERSHIP_SCHEMAS, plan.name)) await lockLeadershipPlan(tx, params.userId, plan.name, resolvedArgs);
        if (plan.expected.contactId) await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${String(plan.expected.contactId)} AND "ownerId" = ${params.userId} FOR UPDATE`;
        if (plan.name === "complete_follow_up") await tx.$queryRaw`SELECT "id" FROM "ContactFollowUp" WHERE "id" = ${String(plan.args.followUpId)} AND "ownerId" = ${params.userId} FOR UPDATE`;
        const current = await describePlan(tx, params.userId, plan.name, resolvedArgs);
        const subjectKey = plan.name === "execute_crm_operation" && plan.expected.subject ? hashAiRequestInput(plan.expected.subject) : null;
        const expected = subjectKey && changedSubjects.has(subjectKey) ? { ...plan.expected, subject: changedSubjects.get(subjectKey) } : plan.expected;
        if (!plan.dependsOn && hashAiRequestInput(current.expected) !== hashAiRequestInput(expected)) throw new AiCrmError("PLAN_STALE", "Der Eintrag wurde inzwischen verändert. Bitte bereite die Änderung erneut vor.", 409);
        const result = await runCrmTool(db, { userId: params.userId, requestId: request.id, aiRequestId: request.id, sessionId: request.conversationId ?? undefined, name: plan.name, arguments: resolvedArgs, transaction: tx, afterCommit });
        if (result.privateResult) result.link = `/api/ai-crm/action-results/${id}`;
        await tx.aiToolExecution.update({ where: { id }, data: { status: "COMPLETED", result: json({ ...result, plan }) } });
        if (subjectKey) {
          try {
            const after = await describeWorkOperation(tx, params.userId, plan.args);
            changedSubjects.set(subjectKey, after.expected.subject);
          } catch (error) { if (!(error instanceof AiCrmError) || error.code !== "NOT_FOUND") throw error; }
        }
      }, { isolationLevel: "Serializable", timeout: 20000 });
      await Promise.allSettled(afterCommit.map(work => work()));
    } catch (error) {
      const code = error instanceof AiCrmError ? error.code : "INTERNAL_ERROR";
      // A transient/unknown outcome is recovered by reading the row, never by
      // starting a new model run. Domain failures leave an individual receipt.
      if (["PLAN_STALE", "NOT_FOUND", "DOMAIN_REJECTED", "FEATURE_DISABLED", "CONTACT_NOT_FOUND", "FOLLOW_UP_NOT_FOUND", "LEADERSHIP_NOT_FOUND", "PARTNER_NOT_FOUND", "LEADERSHIP_FORBIDDEN", "FORBIDDEN"].includes(code)) {
        const execution = await db.aiToolExecution.findFirst({ where: { id, userId: params.userId, requestId: params.requestId, status: "PENDING" } });
        if (execution) await db.aiToolExecution.updateMany({ where: { id, status: "PENDING" }, data: { status: "FAILED", result: json({ ...(execution.result as object), error: safeAiMessage(error) }) } });
      } else throw error;
    }
  }
  return actionReceipts(db, params.userId, params.requestId);
}

/** Editing replaces an immutable proposal. An old click cannot approve the new text. */
export async function reviseActionPlan(db: PrismaClient, params: { userId: string; requestId: string; actionId: string; revision: string; values: Record<string, string>; destinationRequestId?: string }) {
  await db.$transaction(async tx => {
    await assertExecutionAllowed(tx, params.userId, params.destinationRequestId ?? params.requestId, false);
    const requestIds = [params.requestId, ...(params.destinationRequestId ? [params.destinationRequestId] : [])].sort();
    await tx.$queryRaw`SELECT "id" FROM "AiRequest" WHERE "id" IN (${Prisma.join(requestIds)}) AND "userId" = ${params.userId} ORDER BY "id" FOR UPDATE`;
    const request = await tx.aiRequest.findFirst({ where: { id: params.requestId, userId: params.userId, status: "COMPLETED", expiresAt: { gt: new Date() }, conversation: { expiresAt: { gt: new Date() } } } });
    if (params.destinationRequestId) {
      const destination = await tx.aiRequest.findFirst({ where: { id: params.destinationRequestId, userId: params.userId, status: "IN_PROGRESS", conversationId: request?.conversationId, expiresAt: { gt: new Date() } } });
      if (!destination) throw new AiCrmError("PLAN_UNAVAILABLE", "Die aktuelle Anfrage ist nicht mehr verfügbar.", 409);
    }
    const execution = await tx.aiToolExecution.findFirst({ where: { id: params.actionId, userId: params.userId, requestId: params.requestId, status: "PENDING" } });
    const plan = (execution?.result as unknown as Stored)?.plan;
    if (!request || !execution || !plan || planRevision(plan) !== params.revision) throw new AiCrmError("PLAN_STALE", "Bitte lade die aktuelle Vorschau erneut.", 409);
    if (plan.dependsOn && params.destinationRequestId && params.destinationRequestId !== params.requestId) throw new AiCrmError("DEPENDENCY_PENDING", "Bitte bearbeite diese Folgeaktion in ihrer ursprünglichen Vorschau, solange die Kontaktanlage noch offen ist.", 409);
    const fields = editableFields(plan);
    if (!Object.keys(params.values).length || Object.keys(params.values).some(key => !fields.some(field => field.name === key))) throw new AiCrmError("INVALID_EDIT", "Dieses Feld kann hier nicht verändert werden.");
    const nextArgs = plan.name === "execute_crm_operation" ? { ...plan.args, fields: (plan.args.fields as Array<{ name: string; value: string }>).map(field => ({ ...field, value: params.values[field.name] ?? field.value })) } : { ...plan.args, ...Object.fromEntries(Object.entries(params.values).map(([key, value]) => [key, editedValue(plan, key, value)])) };
    for (const field of fields) if (field.options && params.values[field.name] && !field.options.some(option => option.value === params.values[field.name])) throw new AiCrmError("INVALID_EDIT", "Wähle eine berechtigte beteiligte Person.");
    const parsed = parseTool(plan.name, nextArgs);
    const parent = plan.dependsOn ? await tx.aiToolExecution.findFirst({ where: { id: plan.dependsOn, userId: params.userId, requestId: params.requestId, status: "PENDING" } }) : null;
    const parentPlan = (parent?.result as unknown as Stored | null)?.plan;
    if (plan.dependsOn && !parentPlan) throw new AiCrmError("PLAN_STALE", "Die dazugehörige Kontaktanlage hat sich geändert. Bitte bereite die Folgeaktion erneut vor.", 409);
    const updated = await describePlan(tx, params.userId, plan.name, parsed.args, parentPlan ? { ...parentPlan.args, id: parsed.args.contactId } : undefined);
    if (plan.dependsOn) updated.dependsOn = plan.dependsOn;
    await tx.aiToolExecution.update({ where: { id: execution.id }, data: { status: "CANCELED" } });
    await cancelDependents(tx, params.userId, params.requestId, [execution.id]);
    await tx.aiToolExecution.create({ data: { userId: params.userId, requestId: params.destinationRequestId ?? params.requestId, tool: plan.name, idempotencyKey: `${execution.id}:revision:${planRevision(updated)}`, status: "PENDING", result: json({ plan: updated }) } });
  });
  return actionReceipts(db, params.userId, params.destinationRequestId ?? params.requestId);
}

/** The latest displayed proposal group, not an arbitrary historical ordinal. */
export async function pendingProposalList(db: PrismaClient, userId: string, conversationId: string) {
  const request = await db.aiRequest.findFirst({ where: { userId, conversationId, status: "COMPLETED", expiresAt: { gt: new Date() }, toolExecutions: { some: { status: "PENDING" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!request) return [];
  const response = request.response as { scopeFingerprint?: string } | null;
  if (response?.scopeFingerprint && response.scopeFingerprint !== await leadershipScopeFingerprint(db, userId)) return [];
  const executions = await db.aiToolExecution.findMany({ where: { requestId: request.id, userId, status: "PENDING" } });
  for (const execution of executions) {
    const plan = (execution.result as unknown as Stored)?.plan;
    if (!plan) return [];
    try {
      const parent = plan.dependsOn ? executions.find(item => item.id === plan.dependsOn) : null;
      const parentPlan = (parent?.result as unknown as Stored | null)?.plan;
      await describePlan(db, userId, plan.name, plan.args, parentPlan ? { ...parentPlan.args, id: plan.args.contactId } : undefined);
    } catch { return []; }
  }
  return (await actionReceipts(db, userId, request.id)).filter(action => action.status === "PENDING").map((action, index) => ({ ...action, position: index + 1 }));
}

export async function cancelActionPlans(db: PrismaClient, userId: string, requestId: string, actionIds?: string[]) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "AiRequest" WHERE "id" = ${requestId} AND "userId" = ${userId} FOR UPDATE`;
    const request = await tx.aiRequest.findFirst({ where: { id: requestId, userId, expiresAt: { gt: new Date() } } });
    if (!request || request.status === "TOMBSTONED") throw new AiCrmError("REQUEST_NOT_FOUND", "Diese Anfrage ist nicht mehr verfügbar.", 404);
    if (actionIds) await cancelDependents(tx, userId, requestId, actionIds);
    else await tx.aiToolExecution.updateMany({ where: { userId, requestId, status: "PENDING" }, data: { status: "CANCELED" } });
    if (!actionIds) await tx.aiRequest.updateMany({ where: { id: requestId, userId, status: "IN_PROGRESS" }, data: { status: "ABORTED", finishedAt: new Date(), errorCode: "REQUEST_ABORTED" } });
  });
}
