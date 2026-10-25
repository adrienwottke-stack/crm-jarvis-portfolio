import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";
const fixture = await testDatabase();
const db = fixture.client;
process.env.AI_CRM_ENABLED = "true";
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
globalThis.jarvisIntegrationDb = db;
registerHooks({ resolve(specifier, context, next) { return specifier === "@/lib/prisma" ? { url: "data:text/javascript,export const prisma=globalThis.jarvisIntegrationDb", shortCircuit: true } : next(specifier, context); } });
const { stageAction, executeActionPlan, actionReceipts, reviseActionPlan, cancelActionPlans, resolveAssistantContext, pendingProposalList } = await import("../lib/ai-crm/action-plans.ts");
const { runLeadershipRead } = await import("../lib/ai-crm/leadership-tools.ts");
const { readResult, runUxCrmAgent } = await import("../lib/ai-crm/ux-agent.ts");
const { persistConversationExchange } = await import("../lib/ai-crm/conversations.ts");
const { conversationView, requestView } = await import("../lib/ai-crm/presentation.ts");
const { leadershipScopeFingerprint } = await import("../lib/ai-crm/leadership-scope.ts");
const { assistantContextSchema } = await import("../lib/ai-crm/context-schema.ts");
after(() => fixture.close());
async function setup() {
  const owner = await db.user.create({ data: { name: "Test Führung", passwordHash: "fixture", aiBetaEnabled: true } });
  await db.user.update({ where: { id: owner.id }, data: { path: `/${owner.id}/` } });
  const partner = await db.user.create({ data: { name: "Test Partner", passwordHash: "fixture", leaderId: owner.id } });
  await db.user.update({ where: { id: partner.id }, data: { path: `/${owner.id}/${partner.id}/` } });
  const conversation = await db.aiConversation.create({ data: { userId: owner.id, title: "Test", expiresAt: new Date(Date.now() + 86400000) } });
  const request = await db.aiRequest.create({ data: { userId: owner.id, clientRequestId: randomUUID(), kind: "CHAT", status: "IN_PROGRESS", inputHash: "fixture", conversationId: conversation.id, expiresAt: conversation.expiresAt } });
  return { owner, partner, conversation, request };
}
const note = s => ({ partnerId: s.partner.id, text: "Berichtetes Gespräch. Keine automatische Aufgabe.", occurredAt: new Date().toISOString(), appointmentId: null });
const stage = (s, name, args) => stageAction(db, { userId: s.owner.id, requestId: s.request.id, name, arguments: args, key: randomUUID() });
const ready = s => db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED" } });
const receipts = s => actionReceipts(db, s.owner.id, s.request.id);
const confirm = (s, actions) => executeActionPlan(db, { userId: s.owner.id, requestId: s.request.id, actionIds: actions.map(a => a.id), revisions: Object.fromEntries(actions.map(a => [a.id, a.revision])) });

test("edited proposal replaces immutable version; old approval and user-supplied ids cannot write", async () => {
  const s = await setup(); const old = await stage(s, "save_leadership_note", note(s)); await ready(s);
  const [before] = await receipts(s);
  await assert.rejects(reviseActionPlan(db, { userId: s.owner.id, requestId: s.request.id, actionId: old.id, revision: before.revision, values: { partnerId: "foreign" } }), e => e.code === "INVALID_EDIT");
  await reviseActionPlan(db, { userId: s.owner.id, requestId: s.request.id, actionId: old.id, revision: before.revision, values: { text: "Bearbeitet und geprüft" } });
  await confirm(s, [before]);
  assert.equal(await db.leadershipNote.count({ where: { ownerId: s.owner.id } }), 0);
  const current = (await receipts(s)).filter(a => a.status === "PENDING");
  assert.equal(current.length, 1); assert.notEqual(current[0].id, before.id);
  await Promise.all([confirm(s, current), confirm(s, current)]);
  const stored = await db.leadershipNote.findMany({ where: { ownerId: s.owner.id } });
  assert.equal(stored.length, 1); assert.equal(stored[0].text, "Bearbeitet und geprüft");
});

test("note and own task are independently selected and discarded", async () => {
  const s = await setup(); await stage(s, "save_leadership_note", note(s));
  const task = await stage(s, "create_leadership_task", { partnerId: s.partner.id, type: "ANRUF", dueAt: new Date(Date.now() + 86400000).toISOString(), note: "Selbst begleiten", sourceNoteId: null });
  await ready(s); const all = await receipts(s);
  await confirm(s, all.filter(a => a.id !== task.id));
  await cancelActionPlans(db, s.owner.id, s.request.id, [task.id]);
  assert.equal(await db.leadershipNote.count({ where: { ownerId: s.owner.id } }), 1);
  assert.equal(await db.leadershipTask.count({ where: { leaderId: s.owner.id } }), 0);
  assert.deepEqual((await receipts(s)).map(a => a.status).sort(), ["CANCELED", "COMPLETED"]);
});

test("read sources retain correct partner identity, timestamps and honest coverage", async () => {
  const s = await setup(); await db.leadershipNote.create({ data: { ownerId: s.owner.id, partnerId: s.partner.id, text: "Quelle", occurredAt: new Date() } });
  const result = readResult("prepare_partner_meeting", await runLeadershipRead(db, s.owner.id, "prepare_partner_meeting", { partnerId: s.partner.id, since: null }), "source");
  assert.equal(result.items[0].context.partnerId, s.partner.id);
  assert.equal(result.items[0].context.contactId, undefined);
  assert.equal(result.items[0].context.entityType, "note");
  assert.match(result.items[0].detail, /Quelle vom/); assert.ok(result.gaps.length); assert.match(result.coverage, /Abdeckung/);
});

test("revoked hierarchy hides saved answers and sources on reload and operation recovery", async () => {
  const s = await setup(); await db.leadershipNote.create({ data: { ownerId: s.owner.id, partnerId: s.partner.id, text: "Private sensitive fixture", occurredAt: new Date() } });
  const result = readResult("prepare_partner_meeting", await runLeadershipRead(db, s.owner.id, "prepare_partner_meeting", { partnerId: s.partner.id, since: null }), "source");
  const fingerprint = await leadershipScopeFingerprint(db, s.owner.id);
  await persistConversationExchange(db, { userId: s.owner.id, conversationId: s.conversation.id, userMessage: "Vorbereitung", source: "TEXT", assistantMessage: "Private sensitive fixture", actions: [], presentation: { requestId: s.request.id, results: [result], scopeFingerprint: fingerprint }, completeRequest: { id: s.request.id, response: { answer: "Private sensitive fixture", results: [result], scopeFingerprint: fingerprint } } });
  await db.user.update({ where: { id: s.partner.id }, data: { leaderId: null, path: `/${s.partner.id}/` } });
  assert.doesNotMatch(JSON.stringify(await conversationView(db, s.owner.id, s.conversation.id)), /Private sensitive fixture/);
  assert.doesNotMatch(JSON.stringify(await requestView(db, s.owner.id, s.request.id)), /Private sensitive fixture/);
});

test("legacy saved source cards without fingerprint also recheck current authorization", async () => {
  const s = await setup(); const saved = await db.leadershipNote.create({ data: { ownerId: s.owner.id, partnerId: s.partner.id, text: "Secret historical", occurredAt: new Date() } });
  const result = { id: "old", summary: "Secret historical", readAt: new Date().toISOString(), items: [{ id: saved.id, title: "Secret historical", context: { partnerId: s.partner.id, label: s.partner.name, entityType: "note", entityId: saved.id } }] };
  await persistConversationExchange(db, { userId: s.owner.id, conversationId: s.conversation.id, userMessage: "Vorbereitung", source: "TEXT", assistantMessage: "Secret historical", actions: [], presentation: { requestId: s.request.id, results: [result] }, completeRequest: { id: s.request.id, response: { answer: "Secret historical", results: [result] } } });
  await db.user.update({ where: { id: s.partner.id }, data: { leaderId: null, path: `/${s.partner.id}/` } });
  assert.doesNotMatch(JSON.stringify(await conversationView(db, s.owner.id, s.conversation.id)), /Secret historical/);
  assert.doesNotMatch(JSON.stringify(await requestView(db, s.owner.id, s.request.id)), /Secret historical/);
});

test("failed request recovery without a response hides canceled private preview details after access loss", async () => {
  const s = await setup();
  const task = await db.leadershipTask.create({ data: { leaderId: s.owner.id, memberId: s.partner.id, type: "ANRUF", dueAt: new Date(), note: "Private old task fixture" } });
  await stage(s, "update_leadership_task", { taskId: task.id, version: 1, dueAt: task.dueAt.toISOString(), note: "Private proposed fixture" });
  await cancelActionPlans(db, s.owner.id, s.request.id);
  await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "FAILED", errorCode: "LEADERSHIP_SCOPE_CHANGED" } });
  assert.match(JSON.stringify(await requestView(db, s.owner.id, s.request.id)), /Private/);
  await db.user.update({ where: { id: s.partner.id }, data: { leaderId: null, path: `/${s.partner.id}/` } });
  const recovered = await requestView(db, s.owner.id, s.request.id);
  assert.equal(recovered.response, null); assert.deepEqual(recovered.actions, []);
  assert.doesNotMatch(JSON.stringify(recovered), /Private/);
});

test("explicit selection rejects a note from the previous partner and mixed identities", async () => {
  const s = await setup(); const other = await db.user.create({ data: { name: "Other", leaderId: s.owner.id, passwordHash: "fixture" } });
  await db.user.update({ where: { id: other.id }, data: { path: `/${s.owner.id}/${other.id}/` } });
  const saved = await db.leadershipNote.create({ data: { ownerId: s.owner.id, partnerId: s.partner.id, text: "First partner", occurredAt: new Date() } });
  await assert.rejects(resolveAssistantContext(db, s.owner.id, { partnerId: other.id, entityType: "note", entityId: saved.id }), e => e.code === "CONTEXT_MISMATCH");
  assert.equal(assistantContextSchema.safeParse({ partnerId: other.id, contactId: "contact" }).success, false);
});

test("malformed model output cannot create a business record", async () => {
  const s = await setup(); const usage = await db.aiUsage.create({ data: { userId: s.owner.id, kind: "CHAT", requestId: s.request.id } });
  const client = { responses: { create: async () => ({ output_text: "", usage: {}, output: [{ type: "function_call", call_id: randomUUID(), name: "save_leadership_note", arguments: "{bad JSON" }] }) } };
  const result = await runUxCrmAgent({ db, client, userId: s.owner.id, usageId: usage.id, requestId: s.request.id, sessionId: s.conversation.id, message: "Dokumentiere", history: [], context: { partnerId: s.partner.id, label: s.partner.name } });
  assert.ok(result.actions.every(a => a.status === "FAILED"));
  assert.equal(await db.leadershipNote.count({ where: { ownerId: s.owner.id } }), 0);
});

test("spoken revision replaces the displayed proposal without saving or authorizing it", async () => {
  const s = await setup(); await stage(s, "save_leadership_note", note(s)); await ready(s);
  const original = (await receipts(s))[0];
  const next = await db.aiRequest.create({ data: { userId: s.owner.id, clientRequestId: randomUUID(), kind: "CHAT", status: "IN_PROGRESS", inputHash: "next", conversationId: s.conversation.id, expiresAt: s.conversation.expiresAt } });
  const usage = await db.aiUsage.create({ data: { userId: s.owner.id, kind: "CHAT", requestId: next.id } });
  const calls = [{ name: "read_pending_proposals", args: {} }, { name: "revise_pending_proposal", args: { actionId: original.id, changes: [{ field: "text", value: "Neue konkret geprüfte Gesprächsnotiz" }] } }];
  const client = { responses: { create: async () => { const call = calls.shift(); return { output_text: "Vorschau aktualisiert", usage: {}, output: call ? [{ type: "function_call", call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args) }] : [] }; } } };
  const result = await runUxCrmAgent({ db, client, userId: s.owner.id, usageId: usage.id, requestId: next.id, sessionId: s.conversation.id, message: "Ändere den ersten Vorschlag", history: [], context: { partnerId: s.partner.id, label: s.partner.name } });
  assert.equal(result.actions.length, 1); assert.equal(result.actions[0].status, "PENDING");
  assert.notEqual(result.actions[0].id, original.id); assert.equal((await receipts(s))[0].status, "CANCELED");
  await confirm(s, [original]); assert.equal(await db.leadershipNote.count({ where: { ownerId: s.owner.id } }), 0);
});

test("pronoun after partner switch cannot stage a task for the previous person", async () => {
  const s = await setup(); const other = await db.user.create({ data: { name: "Berta", leaderId: s.owner.id, passwordHash: "fixture" } });
  await db.user.update({ where: { id: other.id }, data: { path: `/${s.owner.id}/${other.id}/` } });
  const task = await db.leadershipTask.create({ data: { leaderId: s.owner.id, memberId: s.partner.id, type: "ANRUF", dueAt: new Date(), note: "Alte Person" } });
  const usage = await db.aiUsage.create({ data: { userId: s.owner.id, kind: "CHAT", requestId: s.request.id } });
  const calls = [{ name: "get_leadership_overview", args: { period: "all", partnerId: null, ownOnly: false } }, { name: "complete_leadership_task", args: { taskId: task.id, version: 1 } }];
  const client = { responses: { create: async () => { const call = calls.shift(); return { output_text: "Fertig", usage: {}, output: call ? [{ type: "function_call", call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args) }] : [] }; } } };
  const result = await runUxCrmAgent({ db, client, userId: s.owner.id, usageId: usage.id, requestId: s.request.id, sessionId: s.conversation.id, message: "Markiere ihre Aufgabe als erledigt", history: [], context: { partnerId: other.id, label: other.name } });
  assert.equal(result.actions[0].status, "FAILED"); assert.equal((await db.leadershipTask.findUnique({ where: { id: task.id } })).doneAt, null);
});

test("revoked proposal list is never returned as model context", async () => {
  const s = await setup(); await stage(s, "save_leadership_note", note(s)); await ready(s);
  assert.equal((await pendingProposalList(db, s.owner.id, s.conversation.id)).length, 1);
  await db.user.update({ where: { id: s.partner.id }, data: { leaderId: null, path: `/${s.partner.id}/` } });
  assert.deepEqual(await pendingProposalList(db, s.owner.id, s.conversation.id), []);
});

test("spoken correction cannot edit the previous partner's task proposal after selection changes", async () => {
  const s = await setup(); const other = await db.user.create({ data: { name: "Berta", leaderId: s.owner.id, passwordHash: "fixture" } });
  await db.user.update({ where: { id: other.id }, data: { path: `/${s.owner.id}/${other.id}/` } });
  const task = await db.leadershipTask.create({ data: { leaderId: s.owner.id, memberId: s.partner.id, type: "ANRUF", dueAt: new Date(), note: "Alte Person" } });
  await stage(s, "update_leadership_task", { taskId: task.id, version: 1, dueAt: task.dueAt.toISOString(), note: "Vorbereitete Änderung" }); await ready(s);
  const original = (await receipts(s))[0];
  const next = await db.aiRequest.create({ data: { userId: s.owner.id, clientRequestId: randomUUID(), kind: "CHAT", status: "IN_PROGRESS", inputHash: "next", conversationId: s.conversation.id, expiresAt: s.conversation.expiresAt } });
  const usage = await db.aiUsage.create({ data: { userId: s.owner.id, kind: "CHAT", requestId: next.id } });
  const calls = [{ name: "read_pending_proposals", args: {} }, { name: "revise_pending_proposal", args: { actionId: original.id, changes: [{ field: "note", value: "Bertas neuer Text" }] } }];
  const toolResults = [];
  const client = { responses: { create: async params => { toolResults.push(...params.input.filter(item => item.type === "function_call_output").map(item => item.output)); const call = calls.shift(); return { output_text: "Bitte wähle die richtige Person", usage: {}, output: call ? [{ type: "function_call", call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args) }] : [] }; } } };
  const result = await runUxCrmAgent({ db, client, userId: s.owner.id, usageId: usage.id, requestId: next.id, sessionId: s.conversation.id, message: "Ändere ihren ersten Vorschlag", history: [], context: { partnerId: other.id, label: other.name } });
  assert.equal(result.actions.length, 0); assert.equal((await receipts(s))[0].status, "PENDING");
  assert.match(toolResults.join(" "), /nicht zum aktuell ausgewählten Partner/);
  assert.equal((await db.leadershipTask.findUnique({ where: { id: task.id } })).note, "Alte Person");
});

test("visible date edits use Berlin summer and winter time and reject ambiguous or impossible wall times", async () => {
  for (const [local, expected] of [["2027-07-15T14:30", "2027-07-15T12:30:00.000Z"], ["2027-01-15T14:30", "2027-01-15T13:30:00.000Z"]]) {
    const s = await setup(); await stage(s, "create_leadership_task", { partnerId: s.partner.id, type: "ANRUF", dueAt: "2027-01-10T09:00:00.000Z", note: "Zeit prüfen", sourceNoteId: null }); await ready(s);
    const original = (await receipts(s))[0]; assert.equal(original.fields.find(field => field.name === "dueAt").type, "datetime");
    const revised = await reviseActionPlan(db, { userId: s.owner.id, requestId: s.request.id, actionId: original.id, revision: original.revision, values: { dueAt: local } });
    await confirm(s, revised.filter(action => action.status === "PENDING"));
    assert.equal((await db.leadershipTask.findFirst({ where: { leaderId: s.owner.id } })).dueAt.toISOString(), expected);
  }
  const s = await setup(); await stage(s, "create_leadership_task", { partnerId: s.partner.id, type: "ANRUF", dueAt: "2027-01-10T09:00:00.000Z", note: "Zeit prüfen", sourceNoteId: null }); await ready(s);
  const original = (await receipts(s))[0];
  for (const local of ["2027-03-28T02:30", "2027-10-31T02:30", "2027-02-31T14:30"]) await assert.rejects(reviseActionPlan(db, { userId: s.owner.id, requestId: s.request.id, actionId: original.id, revision: original.revision, values: { dueAt: local } }), error => error.code === "INVALID_EDIT");
  assert.equal((await receipts(s))[0].status, "PENDING"); assert.equal(await db.leadershipTask.count({ where: { leaderId: s.owner.id } }), 0);
});
