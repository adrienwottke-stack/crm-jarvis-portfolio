import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";
const fixture = await testDatabase();
const db = fixture.client;
globalThis.prisma = db;
globalThis.jarvisTestDb = db;
const modules = {
  "@/lib/auth": `export async function requireUser(){const u=await globalThis.jarvisTestDb.user.findUnique({where:{id:globalThis.jarvisActor}}); if(!u||u.deactivatedAt)throw new Error('unauthorized'); return u;} export async function requireAdmin(){const u=await requireUser();if(u.role!=='ADMIN')throw new Error('forbidden');return u;} export async function requireUserPerson(id){return globalThis.jarvisTestDb.person.findUniqueOrThrow({where:{userId:id}});}`,
  "next/cache": "export function revalidatePath(){}",
  "next/navigation": "export function redirect(path){const e=new Error('redirect');e.digest='NEXT_REDIRECT;replace;'+path+';303;';throw e;}",
};
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const { prisma } = await import("../lib/prisma.ts");
globalThis.jarvisTestDb = prisma;
const { withDatabase } = await import("../lib/database-context.ts");
const { setExecutionMode, captureExecutionPolicy } = await import("../lib/ai-crm/execution-policy.ts");
const { stageAction, executeActionPlan, cancelActionPlans } = await import("../lib/ai-crm/action-plans.ts");
const { runCrmTool, CRM_TOOL_DEFINITIONS } = await import("../lib/ai-crm/tools.ts");
const { runUxCrmAgent } = await import("../lib/ai-crm/ux-agent.ts");
const { CRM_OPERATIONS } = await import("../lib/ai-crm/work-registry.ts");
const policyRoute = await import("../app/api/ai-crm/conversations/[id]/route.ts");
const resultRoute = await import("../app/api/ai-crm/action-results/[id]/route.ts");
process.env.AI_CRM_ENABLED = "true";
process.env.AI_CRM_EXECUTION_MODES = "true";
await db.feature.upsert({ where: { key: "aiCrm" }, create: { key: "aiCrm", titel: "AI", state: "TEST" }, update: { state: "TEST" } });
after(async () => fixture.close());

async function setup(mode = "CONFIRM", role = "MEMBER") {
  const name = randomUUID();
  let user = await db.user.create({ data: { name, role, passwordHash: "test-fixture", aiBetaEnabled: true, person: { create: { name } } } });
  user = await db.user.update({ where: { id: user.id }, data: { path: `/${user.id}/` } });
  globalThis.jarvisActor = user.id;
  const contact = await db.contact.create({ data: { ownerId: user.id, name: "Anna Beispiel", listKinds: ["VERKAUF"] } });
  const conversation = await db.aiConversation.create({ data: { userId: user.id, title: "Test", executionMode: mode, expiresAt: new Date(Date.now() + 86400000) } });
  const request = await db.aiRequest.create({ data: { userId: user.id, clientRequestId: randomUUID(), kind: "CHAT", inputHash: "test", status: "IN_PROGRESS", conversationId: conversation.id, expiresAt: conversation.expiresAt } });
  await captureExecutionPolicy(db, user.id, request.id, conversation.id);
  const usage = await db.aiUsage.create({ data: { userId: user.id, kind: "CHAT", requestId: request.id } });
  return { user, contact, conversation, request, usage };
}
const args = (operation, fields) => ({ operation, fields: Object.entries(fields).map(([name, value]) => ({ name, value })) });
const stage = (s, operation, fields) => stageAction(db, { userId: s.user.id, requestId: s.request.id, name: "execute_crm_operation", arguments: args(operation, fields), key: `${s.request.id}:${operation}:${JSON.stringify(fields)}` });
const run = (s, plan, direct = true) => executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: [plan.id], direct });
const change = (s, mode, version = 0) => setExecutionMode(db, { userId: s.user.id, conversationId: s.conversation.id, mode, version });

test("request-scoped database reuses a transaction and rolls all domain writes back", async () => {
  const s = await setup();
  await assert.rejects(db.$transaction(tx => withDatabase(tx, true, [], async () => {
    await prisma.$transaction(inner => inner.contact.update({ where: { id: s.contact.id }, data: { name: "ROLLBACK" } }));
    throw new Error("rollback");
  })), /rollback/);
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).name, "Anna Beispiel");
});
test("read-only blocks even forged staging and confirmation calls", async () => {
  const s = await setup("READ_ONLY");
  await assert.rejects(stage(s, "delete_contact", { contactId: s.contact.id }), e => e.code === "READ_ONLY");
  assert.ok(await db.contact.findUnique({ where: { id: s.contact.id } }));
});
test("confirmation mode stages, then commits exactly once", async () => {
  const s = await setup(); const plan = await stage(s, "rate_contact", { contactId: s.contact.id, rating: "A" });
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).rating, null);
  await assert.rejects(run(s, plan), e => e.code === "CONFIRMATION_REQUIRED");
  await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED" } });
  assert.equal((await run(s, plan, false))[0].status, "COMPLETED");
  await run(s, plan, false);
  assert.equal(await db.aiAuditEvent.count({ where: { requestId: s.request.id, action: "execute_crm_operation" } }), 1);
});
test("autonomous deletion is real and a lost response replay does not execute twice", async () => {
  const s = await setup("AUTONOMOUS"); const plan = await stage(s, "delete_contact", { contactId: s.contact.id });
  assert.equal((await run(s, plan))[0].status, "COMPLETED");
  assert.equal(await db.contact.findUnique({ where: { id: s.contact.id } }), null);
  assert.equal((await run(s, plan))[0].status, "COMPLETED");
});
test("downgrading while an action is pending prevents its commit", async () => {
  const s = await setup("AUTONOMOUS"); const plan = await stage(s, "rate_contact", { contactId: s.contact.id, rating: "A" });
  await change(s, "READ_ONLY");
  await assert.rejects(run(s, plan), e => e.code === "READ_ONLY");
  assert.equal((await db.contact.findUnique({ where: { id: s.contact.id } })).rating, null);
});
test("upgrading does not authorize an old request and policy versions reject stale tabs", async () => {
  const s = await setup(); const plan = await stage(s, "rate_contact", { contactId: s.contact.id, rating: "A" });
  await change(s, "AUTONOMOUS");
  await assert.rejects(run(s, plan), e => e.code === "CONFIRMATION_REQUIRED");
  await assert.rejects(change(s, "READ_ONLY"), e => e.code === "POLICY_STALE");
});
test("foreign chats, contacts and mixed-owner bulk selections remain forbidden", async () => {
  const s = await setup("AUTONOMOUS"); const foreign = await setup(); globalThis.jarvisActor = s.user.id;
  await assert.rejects(setExecutionMode(db, { userId: s.user.id, conversationId: foreign.conversation.id, mode: "AUTONOMOUS", version: 0 }), e => e.code === "CONVERSATION_NOT_FOUND");
  await assert.rejects(stage(s, "delete_contact", { contactId: foreign.contact.id }), e => e.code === "NOT_FOUND");
  await assert.rejects(stage(s, "move_names", { ids: `${s.contact.id},${foreign.contact.id}`, von: "VERKAUF", nach: "RECRUITING" }), e => e.code === "NOT_FOUND");
});
test("member cannot discover or execute administrator operations", async () => {
  const s = await setup("AUTONOMOUS");
  const result = await runCrmTool(db, { userId: s.user.id, requestId: s.request.id, name: "discover_crm_functions", arguments: { area: "all" } });
  assert.ok(!result.data.functions.some(op => op.operation === "set_ai_access"));
  await assert.rejects(stage(s, "set_ai_access", { userId: s.user.id, enabled: "0" }), e => e.code === "FORBIDDEN");
});
test("administrator changes feature through existing domain action", async () => {
  const s = await setup("AUTONOMOUS", "ADMIN"); const key = randomUUID();
  await db.feature.create({ data: { key, titel: "Fixture", state: "TEST" } });
  const plan = await stage(s, "set_feature", { key, state: "LAEUFT", grund: "Test" });
  await run(s, plan);
  assert.equal((await db.feature.findUnique({ where: { key } })).state, "LAEUFT");
});
test("internal message persists once and read access is limited to participants", async () => {
  const recipient = await setup(); const s = await setup("AUTONOMOUS");
  const plan = await stage(s, "send_message", { anId: recipient.user.id, text: "Termin passt." });
  await run(s, plan); await run(s, plan);
  assert.equal(await db.nachricht.count({ where: { vonId: s.user.id, anId: recipient.user.id } }), 1);
  const stranger = await setup();
  const result = await runCrmTool(db, { userId: stranger.user.id, requestId: stranger.request.id, name: "read_crm_data", arguments: { area: "communication", query: null, offset: 0, day: null, scope: null } });
  assert.equal(result.data.items.length, 0);
});
test("pagination reports its coverage and never includes another owner's contacts", async () => {
  const s = await setup("READ_ONLY");
  await db.contact.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ name: `Kontakt ${i}`, ownerId: s.user.id })) });
  const read = offset => runCrmTool(db, { userId: s.user.id, requestId: s.request.id, name: "read_crm_data", arguments: { area: "contacts", query: null, offset, day: null, scope: null } });
  const first = await read(0); const second = await read(50);
  assert.equal(first.data.items.length, 50); assert.equal(first.data.coverage.complete, false); assert.equal(first.data.coverage.total, 56);
  assert.equal(second.data.items.length, 6); assert.equal(second.data.coverage.nextOffset, null);
});
test("tool catalogue uses strict schemas and rejects unspecified fields", async () => {
  assert.ok(Object.keys(CRM_OPERATIONS).length > 35);
  for (const tool of CRM_TOOL_DEFINITIONS) { assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false); }
  const s = await setup("AUTONOMOUS");
  await assert.rejects(stage(s, "rate_contact", { contactId: s.contact.id, rating: "A", ownerId: "foreign" }), e => e.code === "INVALID_TOOL_INPUT");
});
test("chat mode endpoint enforces same origin and current version", async () => {
  const s = await setup();
  const request = origin => new Request("http://localhost/api/ai-crm/conversations/" + s.conversation.id, { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ executionMode: "AUTONOMOUS", executionVersion: 0 }) });
  assert.equal((await policyRoute.PATCH(request("https://foreign.invalid"), { params: Promise.resolve({ id: s.conversation.id }) })).status, 403);
  const response = await policyRoute.PATCH(request("http://localhost"), { params: Promise.resolve({ id: s.conversation.id }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).executionMode, "AUTONOMOUS");
});
test("autonomous agent executes a concrete request and returns a persisted receipt", async () => {
  const s = await setup("AUTONOMOUS"); let round = 0;
  const client = { responses: { create: async () => ++round === 1 ? { output: [{ type: "function_call", call_id: "call_1", name: "add_note", arguments: JSON.stringify({ contactId: s.contact.id, text: "Morgen erreichbar." }) }], output_text: "" } : { output: [], output_text: "Die Notiz ist gespeichert." } } };
  const result = await runUxCrmAgent({ db, client, userId: s.user.id, requestId: s.request.id, usageId: s.usage.id, sessionId: s.conversation.id, message: "Notier: Morgen erreichbar.", history: [], context: { contactId: s.contact.id, label: s.contact.name } });
  assert.equal(result.actions[0].status, "COMPLETED");
  assert.match((await db.contact.findUnique({ where: { id: s.contact.id } })).note, /Morgen erreichbar/);
});

test("production database proxy can enter a read scope without recursively wrapping itself", async () => {
  const s = await setup();
  const result = await runCrmTool(prisma, { userId: s.user.id, requestId: s.request.id, name: "read_crm_data", arguments: { area: "performance", query: null, offset: 0, day: null, scope: null } });
  assert.equal(result.ok, true);
});

test("new-contact dependencies remain previews and execute in order without duplicates", async () => {
  const s = await setup();
  const parent = await stageAction(db, { userId: s.user.id, requestId: s.request.id, name: "create_contact", arguments: { name: "Neue Anna", phone: null, email: null, source: null, job: null, note: null }, key: randomUUID() });
  const child = await stageAction(db, { userId: s.user.id, requestId: s.request.id, name: "create_follow_up", arguments: { contactId: `pending:${parent.id}`, type: "ANRUF", at: new Date(Date.now() + 86400000).toISOString(), note: "Vereinbarter Anruf" }, key: randomUUID() });
  assert.equal(await db.contact.count({ where: { ownerId: s.user.id, name: "Neue Anna" } }), 0);
  await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED" } });
  await assert.rejects(run(s, child, false), e => e.code === "DEPENDENCY_PENDING");
  await executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: [parent.id, child.id] });
  const contact = await db.contact.findFirstOrThrow({ where: { ownerId: s.user.id, name: "Neue Anna" } });
  assert.equal(await db.contactFollowUp.count({ where: { contactId: contact.id, note: "Vereinbarter Anruf" } }), 1);
  await executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: [parent.id, child.id] });
  assert.equal(await db.contact.count({ where: { ownerId: s.user.id, name: "Neue Anna" } }), 1);
});

test("cancelling a new contact also cancels its dependent follow-up without writing data", async () => {
  const s = await setup();
  const parent = await stageAction(db, { userId: s.user.id, requestId: s.request.id, name: "create_contact", arguments: { name: "Cancelled Anna", phone: null, email: null, source: null, job: null, note: null }, key: randomUUID() });
  const child = await stageAction(db, { userId: s.user.id, requestId: s.request.id, name: "create_follow_up", arguments: { contactId: `pending:${parent.id}`, type: "ANRUF", at: new Date(Date.now() + 86400000).toISOString(), note: "Cancelled follow-up" }, key: randomUUID() });
  await cancelActionPlans(db, s.user.id, s.request.id, [parent.id]);
  const rows = await db.aiToolExecution.findMany({ where: { id: { in: [parent.id, child.id] } } });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.status === "CANCELED"));
  assert.equal(await db.contact.count({ where: { ownerId: s.user.id, name: "Cancelled Anna" } }), 0);
});

test("revoked beta and administrator rights stop pending writes", async () => {
  const s = await setup("AUTONOMOUS", "ADMIN");
  const plan = await stage(s, "set_feature", { key: "aiCrm", state: "TEST", grund: "Test" });
  await db.user.update({ where: { id: s.user.id }, data: { role: "MEMBER" } });
  assert.equal((await run(s, plan))[0].status, "FAILED");
  const own = await stage(s, "rate_contact", { contactId: s.contact.id, rating: "B" });
  await db.user.update({ where: { id: s.user.id }, data: { aiBetaEnabled: false } });
  await assert.rejects(run(s, own), e => e.code === "AI_NOT_ENTITLED");
  assert.equal((await db.contact.findUniqueOrThrow({ where: { id: s.contact.id } })).rating, null);
});

test("a batch can update the same contact twice without treating its own first write as foreign", async () => {
  const s = await setup();
  const rating = await stage(s, "rate_contact", { contactId: s.contact.id, rating: "A" });
  const outcome = await stage(s, "record_call_result", { contactId: s.contact.id, result: "unreachable" });
  await db.aiRequest.update({ where: { id: s.request.id }, data: { status: "COMPLETED" } });
  const receipts = await executeActionPlan(db, { userId: s.user.id, requestId: s.request.id, actionIds: [rating.id, outcome.id] });
  assert.ok(receipts.every(item => item.status === "COMPLETED"));
  assert.equal((await db.contact.findUniqueOrThrow({ where: { id: s.contact.id } })).rating, "A");
});

test("name collecting, bulk list movement and pipeline outcome use existing domain workflows", async () => {
  const s = await setup("AUTONOMOUS");
  const collected = await stage(s, "collect_name", { name: "Neuer Kandidat", listKind: "RECRUITING", phone: "1234567" });
  const receipt = (await run(s, collected)).find(item => item.id === collected.id);
  assert.equal(receipt.entityType, "Contact"); assert.ok(receipt.entityId);
  const moved = await stage(s, "move_names", { ids: `${s.contact.id},${receipt.entityId}`, von: "", nach: "VERKAUF" });
  assert.equal((await run(s, moved)).find(item => item.id === moved.id).status, "COMPLETED");
  const result = await stage(s, "record_call_result", { contactId: s.contact.id, result: "unreachable", note: "Morgen erneut versuchen" });
  await run(s, result);
  assert.ok(await db.activity.count({ where: { contactId: s.contact.id } }));
});

test("calculator scenario versioning and cross-owner protections remain effective", async () => {
  const s = await setup("AUTONOMOUS");
  await db.feature.upsert({ where: { key: "zinsrechner" }, create: { key: "zinsrechner", titel: "Rechner", state: "TEST" }, update: { state: "TEST" } });
  const values = JSON.stringify({ schemaVersion: 1, start: 5000, monthly: 300, years: 10, scenario: "custom", customRate: 4, waitYears: 0, goals: [], customerName: "Anna" });
  const plan = await stage(s, "save_calculator_scenario", { title: "Annahme", version: "0", contactId: s.contact.id, values });
  const saved = (await run(s, plan)).find(item => item.id === plan.id);
  assert.equal(saved.status, "COMPLETED"); assert.ok(saved.entityId);
  const stranger = await setup("AUTONOMOUS");
  await assert.rejects(stage(stranger, "delete_calculator_scenario", { id: saved.entityId, version: "1" }), e => e.code === "NOT_FOUND");
});

test("member reads every permitted domain without exposing authentication secrets", async () => {
  const s = await setup("READ_ONLY");
  for (const area of ["contacts", "pipeline", "team", "goals", "performance", "communication", "calendar", "profile", "feed", "onboarding", "exports", "calculator"]) {
    const result = await runCrmTool(db, { userId: s.user.id, requestId: s.request.id, name: "read_crm_data", arguments: { area, query: null, offset: 0, day: null, scope: null } });
    assert.equal(result.ok, true, area);
    assert.doesNotMatch(JSON.stringify(result), /passwordHash|passwordSalt|encryptedPassword|refreshToken|sessionSecret/);
  }
});

test("admin reset exposes only a protected result link, never the reset credential in receipts", async () => {
  const s = await setup("AUTONOMOUS", "ADMIN");
  const target = await setup(); globalThis.jarvisActor = s.user.id;
  const plan = await stage(s, "create_password_reset", { userId: target.user.id });
  const receipts = await run(s, plan);
  const reset = await db.passwortReset.findFirstOrThrow({ where: { userId: target.user.id, usedAt: null } });
  assert.ok(!JSON.stringify(receipts).includes(reset.code));
  const response = await resultRoute.GET(new Request(`http://localhost/api/ai-crm/action-results/${plan.id}`), { params: Promise.resolve({ id: plan.id }) });
  assert.equal(response.status, 303); assert.ok(response.headers.get("location").includes(encodeURIComponent(reset.code)));
  const stranger = await setup("AUTONOMOUS", "ADMIN"); globalThis.jarvisActor = stranger.user.id;
  assert.equal((await resultRoute.GET(new Request(`http://localhost/api/ai-crm/action-results/${plan.id}`), { params: Promise.resolve({ id: plan.id }) })).status, 404);
});

test("chat policies are isolated and newly created chats start with confirmation", async () => {
  const s = await setup("AUTONOMOUS");
  const other = await db.aiConversation.create({ data: { userId: s.user.id, title: "Zweiter Chat", expiresAt: s.conversation.expiresAt } });
  assert.equal(other.executionMode, "CONFIRM");
  await change(s, "READ_ONLY");
  assert.equal((await db.aiConversation.findUniqueOrThrow({ where: { id: other.id } })).executionMode, "CONFIRM");
});

test("goals, unit booking, profile and structure creation run their normal workflows", async () => {
  const s = await setup("AUTONOMOUS");
  const { berlinToday } = await import("../lib/dates.ts");
  for (const [operation, fields] of [
    ["save_goal", { kennzahl: "CALL", zielwert: "20", zeitraum: "WOCHE", tag: berlinToday(), titel: "Telefonwoche", hauptziel: "ja" }],
    ["book_units", { menge: "12,50", tag: berlinToday(), notiz: "Testbuchung" }],
    ["save_profile_phone", { phone: "+49 170 1234567" }],
    ["create_team_person", { name: "Neue Strukturperson", mitEinladung: "" }],
  ]) {
    const plan = await stage(s, operation, fields);
    const receipt = (await run(s, plan)).find(item => item.id === plan.id);
    assert.equal(receipt.status, "COMPLETED", `${operation}: ${receipt.error}`);
  }
  assert.equal(await db.ziel.count({ where: { inhaberId: s.user.id, titel: "Telefonwoche" } }), 1);
  assert.equal(await db.einheitenbuchung.count({ where: { userId: s.user.id } }), 1);
  assert.equal(await db.user.count({ where: { leaderId: s.user.id, name: "Neue Strukturperson" } }), 1);
  const invalid = await stage(s, "book_units", { menge: "keine Zahl", tag: berlinToday() });
  assert.equal((await run(s, invalid)).find(item => item.id === invalid.id).status, "FAILED");
  assert.equal(await db.einheitenbuchung.count({ where: { userId: s.user.id } }), 1);
});
