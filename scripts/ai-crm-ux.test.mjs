import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";
const fixture = await testDatabase();
const db = fixture.client;
globalThis.uxDb = db;
const modules = { "@/lib/prisma": "export const prisma=globalThis.uxDb", "@/lib/auth": "export async function requireUser(){return globalThis.uxUser}", "next/cache": "export function revalidatePath(){}" };
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const { stageAction, executeActionPlan, cancelActionPlans, actionReceipts, permitsDirectAction, resolveAssistantContext } = await import("../lib/ai-crm/action-plans.ts");
const { runUxCrmAgent, readResult } = await import("../lib/ai-crm/ux-agent.ts");
const { runCrmTool } = await import("../lib/ai-crm/tools.ts");
const { undoAusfuehren } = await import("../lib/undo.ts");
const { deleteConversation, listConversations, persistConversationExchange } = await import("../lib/ai-crm/conversations.ts");
const { conversationView, requestView } = await import("../lib/ai-crm/presentation.ts");
const route = await import("../app/api/ai-crm/requests/[id]/route.ts");
after(async () => fixture.close());
process.env.AI_CRM_ENABLED = "true";
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });

async function setup() {
  const name = randomUUID();
  const user = await db.user.create({ data: { name, aiBetaEnabled: true, person: { create: { name } } } });
  const contact = await db.contact.create({ data: { ownerId: user.id, name: "Jonas Müller", phone: "123", note: "Bestehende Notiz" } });
  const conversation = await db.aiConversation.create({ data: { userId: user.id, title: "Testgespräch", expiresAt: new Date(Date.now() + 86400000) } });
  const request = await db.aiRequest.create({ data: { userId: user.id, clientRequestId: randomUUID(), kind: "CHAT", inputHash: "test", status: "IN_PROGRESS", conversationId: conversation.id, expiresAt: conversation.expiresAt } });
  const usage = await db.aiUsage.create({ data: { userId: user.id, kind: "CHAT", requestId: request.id } });
  return { user, contact, conversation, request, usage };
}
const updateArgs = contact => ({ contactId: contact.id, changeFields: ["phone"], phone: "456", name: null, email: null, source: null, job: null });
async function stage(s, name, args) { return stageAction(db, { userId: s.user.id, requestId: s.request.id, name, arguments: args, key: randomUUID() }); }
async function confirm(s, ids) { return executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: ids }); }
async function ready(s) { await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED" } }); }

test("sensitive updates are immutable previews and double confirmation executes once", async () => {
  const s = await setup(); const plan = await stage(s, "update_contact", updateArgs(s.contact));
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).phone, "123");
  await assert.rejects(confirm(s, [plan.id]), error => error.code === "PLAN_UNAVAILABLE");
  await ready(s);
  await Promise.all([confirm(s, [plan.id]), confirm(s, [plan.id])]);
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).phone, "456");
  assert.equal(await db.aiAuditEvent.count({ where: { requestId: s.request.id, success: true } }), 1);
  const [receipt] = await actionReceipts(db, s.user.id, s.request.id);
  assert.equal(receipt.status, "COMPLETED"); assert.equal(receipt.undoStatus, "AVAILABLE");
  assert.equal(receipt.changes[0].before, "123"); assert.equal(receipt.changes[0].after, "456");
});
test("stale previews do not overwrite changes from the ordinary CRM", async () => {
  const s = await setup(); const plan = await stage(s, "update_contact", updateArgs(s.contact)); await ready(s);
  await db.contact.update({ where: { id: s.contact.id }, data: { phone: "manuell" } });
  const [receipt] = await confirm(s, [plan.id]); assert.equal(receipt.status, "FAILED");
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).phone, "manuell");
});
test("confirmation is owner scoped, rejects browser parameters and expired plans", async () => {
  const s = await setup(), foreign = await setup(); const plan = await stage(s, "update_contact", updateArgs(s.contact)); await ready(s);
  await assert.rejects(executeActionPlan(db, { userId: foreign.user.id, requestId: s.request.id, actionIds: [plan.id] }));
  await assert.rejects(resolveAssistantContext(db, foreign.user.id, { contactId: s.contact.id }));
  globalThis.uxUser = s.user;
  const response = await route.POST(new Request(`https://crm.example.test/api/ai-crm/requests/${s.request.id}`, { method: "POST", headers: { origin: "https://crm.example.test", "content-type": "application/json" }, body: JSON.stringify({ action: "confirm", actionIds: [plan.id], arguments: { phone: "hijack" } }) }), { params: Promise.resolve({ id: s.request.id }) });
  assert.equal(response.status, 400);
  await db.aiRequest.update({ where: { id: s.request.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  await assert.rejects(confirm(s, [plan.id]));
});
test("cancel retains completed receipts and prevents remaining actions", async () => {
  const s = await setup(); const first = await stage(s, "add_note", { contactId: s.contact.id, text: "Neu" }); const second = await stage(s, "update_contact", updateArgs(s.contact)); await ready(s);
  await confirm(s, [first.id]); await cancelActionPlans(db, s.user.id, s.request.id); await confirm(s, [second.id]);
  const receipts = await actionReceipts(db, s.user.id, s.request.id); assert.equal(receipts.find(item => item.id === first.id).status, "COMPLETED"); assert.equal(receipts.find(item => item.id === second.id).status, "CANCELED");
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).phone, "123");
});
test("undo survives reopen, uses actual expiry and refuses a changed record", async () => {
  const s = await setup(); const plan = await stage(s, "add_note", { contactId: s.contact.id, text: "Neu" }); await ready(s);
  const [receipt] = await confirm(s, [plan.id]);
  const undo = await db.undoEntry.findUnique({ where: { id: receipt.undoEntryId } }); assert.equal(Date.parse(receipt.undoExpiresAt), undo.createdAt.getTime() + 30000);
  await db.contact.update({ where: { id: s.contact.id }, data: { note: "Später manuell" } });
  assert.equal((await actionReceipts(db, s.user.id, s.request.id))[0].undoStatus, "CONFLICT");
  await assert.rejects(undoAusfuehren(s.user.id, receipt.undoEntryId, db), error => error.code === "UNDO_CONFLICT");
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).note, "Später manuell");
  await db.undoEntry.update({ where: { id: receipt.undoEntryId }, data: { createdAt: new Date(Date.now() - 31000) } });
  assert.equal((await actionReceipts(db, s.user.id, s.request.id))[0].undoStatus, "EXPIRED");
});
test("a successful undo is reflected in reloaded action state", async () => {
  const s = await setup(); const plan = await stage(s, "create_follow_up", { contactId: s.contact.id, type: "ANRUF", at: new Date(Date.now() + 3600000).toISOString(), note: "Anrufen" }); await ready(s);
  const [receipt] = await confirm(s, [plan.id]); await undoAusfuehren(s.user.id, receipt.undoEntryId, db);
  assert.equal(await db.contactFollowUp.count({ where: { contactId: s.contact.id } }), 0);
  assert.equal((await actionReceipts(db, s.user.id, s.request.id))[0].undoStatus, "UNDONE");
});
test("every business write needs visible confirmation including explicit short commands", () => {
  assert.equal(permitsDirectAction("Bitte erstelle eine Wiedervorlage für Jonas.", "create_follow_up", 1), false);
  assert.equal(permitsDirectAction("Ich habe mit Jonas gesprochen.", "add_activity", 1), false);
  assert.equal(permitsDirectAction("Dokumentiere das Gespräch und erstelle eine Wiedervorlage", "add_activity", 2), false);
  assert.equal(permitsDirectAction("Bitte notiere keine Notiz", "add_note", 1), false);
  assert.equal(permitsDirectAction("Bitte ändere die Telefonnummer", "update_contact", 1), false);
});
test("contact results never turn a synthesized next step into a follow-up context", async () => {
  const s = await setup();
  const at = new Date(Date.now() + 3_600_000);
  await db.contact.update({
    where: { id: s.contact.id },
    data: { nextStepAt: at, nextStepType: "ANRUF", nextStepNote: "Morgen anrufen" },
  });
  const followUp = await db.contactFollowUp.create({
    data: { contactId: s.contact.id, ownerId: s.user.id, type: "ANRUF", at, note: "Morgen anrufen" },
  });

  const contact = readResult(
    "get_contact",
    await runCrmTool(db, { userId: s.user.id, requestId: s.request.id, name: "get_contact", arguments: { contactId: s.contact.id } }),
    "contact-read",
  );
  assert.equal(contact.items[0].context?.contactId, s.contact.id);
  assert.equal(contact.items[0].context?.followUpId, undefined);
  await assert.doesNotReject(resolveAssistantContext(db, s.user.id, contact.items[0].context));

  const stale = readResult(
    "get_stale_contacts",
    await runCrmTool(db, { userId: s.user.id, requestId: s.request.id, name: "get_stale_contacts", arguments: { before: "2035-01-01", limit: 10 } }),
    "stale-read",
  );
  const staleContact = stale.items.find(item => item.context?.contactId === s.contact.id);
  assert.ok(staleContact);
  assert.equal(staleContact.context?.followUpId, undefined);

  const followUps = readResult(
    "get_contact_follow_ups",
    await runCrmTool(db, { userId: s.user.id, requestId: s.request.id, name: "get_contact_follow_ups", arguments: { contactId: s.contact.id } }),
    "follow-up-read",
  );
  assert.equal(followUps.items[0].context?.followUpId, followUp.id);
});
function clientFor(calls) {
  let round = 0;
  return { responses: { create: async () => {
    const call = calls[round++];
    return { output_text: call ? "" : "Alles schon gespeichert!", usage: { input_tokens: 1, output_tokens: 1 }, output: call ? [{ type: "function_call", call_id: randomUUID(), name: call.name, arguments: JSON.stringify(call.args) }] : [] };
  } } };
}
test("the model cannot bypass confirmation even when its final text claims success", async () => {
  const s = await setup();
  const result = await runUxCrmAgent({ client: clientFor([{ name: "update_contact", args: updateArgs(s.contact) }]), db, userId: s.user.id, usageId: s.usage.id, requestId: s.request.id, sessionId: s.conversation.id, message: "Ändere die Telefonnummer", history: [], context: { contactId: s.contact.id, label: s.contact.name } });
  assert.equal(result.actions[0].status, "PENDING"); assert.match(result.answer, /erst nach deiner Bestätigung/);
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).phone, "123");
});
test("multi-step commands remain pending as a whole and give individual receipts", async () => {
  const s = await setup();
  const result = await runUxCrmAgent({ client: clientFor([{ name: "add_note", args: { contactId: s.contact.id, text: "Notiz" } }, { name: "create_follow_up", args: { contactId: s.contact.id, type: "ANRUF", at: new Date(Date.now() + 3600000).toISOString(), note: "Anrufen" } }]), db, userId: s.user.id, usageId: s.usage.id, requestId: s.request.id, sessionId: s.conversation.id, message: "Notiere eine Notiz und erstelle eine Wiedervorlage", history: [], context: { contactId: s.contact.id, label: s.contact.name } });
  assert.equal(result.actions.length, 2); assert.ok(result.actions.every(item => item.status === "PENDING"));
  assert.equal(await db.contactFollowUp.count({ where: { contactId: s.contact.id } }), 0);
  await ready(s); const receipts = await confirm(s, result.actions.map(item => item.id)); assert.ok(receipts.every(item => item.status === "COMPLETED"));
});
test("conversation presentation restores structured data and current plan status", async () => {
  const s = await setup(); const plan = await stage(s, "update_contact", updateArgs(s.contact));
  await persistConversationExchange(db, { userId: s.user.id, conversationId: s.conversation.id, userMessage: "Ändern", source: "TEXT", assistantMessage: "Bitte prüfen", actions: await actionReceipts(db, s.user.id, s.request.id), presentation: { requestId: s.request.id, results: [{ id: "read", summary: "Jonas", items: [], readAt: new Date().toISOString() }] }, completeRequest: { id: s.request.id, response: { answer: "Bitte prüfen" } } });
  await confirm(s, [plan.id]); const view = await conversationView(db, s.user.id, s.conversation.id);
  assert.equal(view.messages[1].actions[0].status, "COMPLETED"); assert.equal(view.messages[1].results[0].id, "read");
  const state = await requestView(db, s.user.id, s.request.clientRequestId); assert.equal(state.actions[0].status, "COMPLETED");
});
test("an owner can retrieve a completed live turn through the ordinary request status route", async () => {
  const s = await setup();
  const live = await db.aiRequest.create({
    data: {
      userId: s.user.id,
      clientRequestId: randomUUID(),
      kind: "LIVE_TURN",
      inputHash: "live-status",
      status: "COMPLETED",
      conversationId: s.conversation.id,
      expiresAt: s.conversation.expiresAt,
      response: { requestId: "live-status", answer: "Die Live-Zeile ist gespeichert." },
    },
  });
  const state = await requestView(db, s.user.id, live.clientRequestId);
  assert.equal(state.id, live.id);
  assert.equal(state.response?.requestId, "live-status");

  globalThis.uxUser = s.user;
  const response = await route.GET(
    new Request(`https://crm.example.test/api/ai-crm/requests/${live.id}`),
    { params: Promise.resolve({ id: live.id }) },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).response.requestId, "live-status");
});

test("a failed step remains visible and prevents direct execution of a surviving step", async () => {
  const s = await setup();
  const result = await runUxCrmAgent({ client: clientFor([{ name: "add_activity", args: { contactId: s.contact.id, type: "CALL", text: "Gespräch", occurredAt: null } }, { name: "create_follow_up", args: { contactId: "unknown-contact", type: "ANRUF", at: new Date(Date.now() + 3600000).toISOString(), note: "Anrufen" } }]), db, userId: s.user.id, usageId: s.usage.id, requestId: s.request.id, sessionId: s.conversation.id, message: "Dokumentiere das Gespräch und erstelle eine Wiedervorlage", history: [], context: { contactId: s.contact.id, label: s.contact.name } });
  assert.equal(result.actions.length, 2);
  assert.deepEqual(result.actions.map(item => item.status).sort(), ["FAILED", "PENDING"]);
  assert.match(result.answer, /Nicht alle Schritte/);
  assert.equal(await db.activity.count({ where: { contactId: s.contact.id } }), 0);
  await ready(s);
  const saved = await confirm(s, result.actions.filter(item => item.status === "PENDING").map(item => item.id));
  assert.deepEqual(saved.map(item => item.status).sort(), ["COMPLETED", "FAILED"]);
});

test("expired conversations with interrupted requests are purged without CRM deletion", async () => {
  const s = await setup();
  const plan = await stage(s, "update_contact", updateArgs(s.contact));
  await db.aiConversation.update({ where: { id: s.conversation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await deleteConversation(db, s.user.id, s.conversation.id);
  assert.equal(await db.aiConversation.count({ where: { id: s.conversation.id } }), 0);
  assert.equal((await db.aiRequest.findUnique({ where: { id: s.request.id } })).status, "TOMBSTONED");
  assert.equal((await db.aiToolExecution.findUnique({ where: { id: plan.id } })).result, null);
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).phone, "123");
});
test("all valid conversations are pageable and deletion protects in-flight work", async () => {
  const s = await setup();
  await assert.rejects(deleteConversation(db, s.user.id, s.conversation.id), error => error.code === "CONVERSATION_BUSY");
  for (let index = 0; index < 11; index++) await db.aiConversation.create({ data: { userId: s.user.id, title: `Gespräch ${index}`, expiresAt: new Date(Date.now() + 86400000) } });
  const first = await listConversations(db, s.user.id); const second = await listConversations(db, s.user.id, new Date(), first.at(-1).id);
  assert.equal(first.length, 10); assert.equal(second.length, 2); assert.equal(new Set([...first, ...second].map(item => item.id)).size, 12);
  await cancelActionPlans(db, s.user.id, s.request.id); await deleteConversation(db, s.user.id, s.conversation.id);
  assert.equal(await db.contact.count({ where: { id: s.contact.id } }), 1);
});
