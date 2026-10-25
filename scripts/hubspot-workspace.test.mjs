import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";
import { contactListReturn, contactHref } from "../lib/contact-navigation.ts";
import { berechne, standardWerte } from "../lib/zinsrechner.ts";
import { CRM_HELP } from "../lib/crm-help.ts";

const fixture = await testDatabase(), db = fixture.client;
globalThis.workspaceDb = db;
const modules = { "@/lib/prisma": "export const prisma=globalThis.workspaceDb", "next/cache": "export function revalidatePath(){}" };
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const { runCrmTool, parseTool } = await import("../lib/ai-crm/tools.ts");
const { readResult } = await import("../lib/ai-crm/ux-agent.ts");
const { stageAction, actionReceipts, reviseActionPlan, executeActionPlan } = await import("../lib/ai-crm/action-plans.ts");
after(async () => fixture.close());
process.env.AI_CRM_ENABLED = "true";
for (const key of ["aiCrm", "zinsrechner"]) await db.feature.upsert({ where: { key }, create: { key, titel: key, state: "TEST" }, update: { state: "TEST" } });
const user = await db.user.create({ data: { name: "Workspace Test", aiBetaEnabled: true, person: { create: { name: "Workspace Test" } } } });

test("contact return paths retain view and filters without accepting redirects or arbitrary query keys", () => {
  const url = "/namen?liste=RECRUITING&q=M%C3%BCller&status=offen&telefon=mit";
  assert.equal(contactListReturn(url), url);
  assert.equal(new URL(contactHref("contact-id", url, true), "https://local.test").searchParams.get("returnTo"), url);
  for (const bad of ["https://example.test", "//example.test", "/namen/../profil", "/namen#x", "\\namen", null]) assert.equal(contactListReturn(bad), "/namen");
  assert.equal(contactListReturn("/namen?q=Jonas&redirect=https://example.test"), "/namen?q=Jonas");
});

test("calculator tool uses the existing formula, hands off identical inputs and writes no scenario", async () => {
  const args = { start: 1000, monthly: 100, years: 10, rate: 5 };
  const before = await db.zinsSzenario.count();
  const result = await runCrmTool(db, { userId: user.id, requestId: randomUUID(), name: "calculate_interest", arguments: args });
  const expected = berechne({ ...standardWerte(), start: args.start, monthly: args.monthly, years: args.years, scenario: "custom", customRate: args.rate }).main;
  assert.deepEqual(result.data.result, { end: expected.end, paid: expected.paid, gain: expected.gain });
  const query = new URL(result.link, "https://local.test").searchParams;
  assert.equal(query.get("start"), "1000"); assert.equal(query.get("monatlich"), "100"); assert.equal(query.get("jahre"), "10"); assert.equal(query.get("rendite"), "5");
  const card = readResult("calculate_interest", result, "test");
  assert.equal(card.items[0].context, undefined); assert.equal(card.items[0].link, result.link);
  assert.equal(await db.zinsSzenario.count(), before);
});

test("calculator rejects invalid assumptions and honors the same feature gate", async () => {
  for (const patch of [{ years: 0 }, { monthly: 2001 }, { rate: Infinity }, { start: -1 }, { years: 2.5 }]) assert.throws(() => parseTool("calculate_interest", { start: 0, monthly: 100, years: 10, rate: 5, ...patch }));
  await db.feature.update({ where: { key: "zinsrechner" }, data: { state: "AUS" } });
  try { await assert.rejects(runCrmTool(db, { userId: user.id, requestId: randomUUID(), name: "calculate_interest", arguments: { start: 0, monthly: 100, years: 10, rate: 5 } }), error => error.code === "FEATURE_DISABLED"); }
  finally { await db.feature.update({ where: { key: "zinsrechner" }, data: { state: "TEST" } }); }
});

test("assistant help uses the manual help source and never turns help entries into contacts", async () => {
  const result = await runCrmTool(db, { userId: user.id, requestId: randomUUID(), name: "get_crm_help", arguments: {} });
  assert.deepEqual(result.data.items, [...CRM_HELP]);
  const cards = readResult("get_crm_help", result, "help");
  assert.ok(cards.items.every(item => !item.context && item.link.startsWith("/")));
});

test("manual proposal editing invalidates the old confirmation; retries of the revised action save once", async () => {
  const contact = await db.contact.create({ data: { ownerId: user.id, name: "Mixed workflow", phone: "111" } });
  const conversation = await db.aiConversation.create({ data: { userId: user.id, title: "Mixed", expiresAt: new Date(Date.now() + 86400000) } });
  const request = await db.aiRequest.create({ data: { userId: user.id, clientRequestId: randomUUID(), kind: "CHAT", inputHash: "test", status: "IN_PROGRESS", conversationId: conversation.id, expiresAt: conversation.expiresAt } });
  const plan = await stageAction(db, { userId: user.id, requestId: request.id, name: "update_contact", arguments: { contactId: contact.id, changeFields: ["phone"], phone: "222", name: null, email: null, source: null, job: null }, key: randomUUID() });
  await db.aiRequest.update({ where: { id: request.id }, data: { status: "COMPLETED" } });
  const [receipt] = await actionReceipts(db, user.id, request.id);
  assert.deepEqual(receipt.fields.map(field => field.name), ["phone"]);
  await reviseActionPlan(db, { userId: user.id, requestId: request.id, actionId: plan.id, revision: receipt.revision, values: { phone: "333" } });
  await executeActionPlan(db, { userId: user.id, requestId: request.id, actionIds: [plan.id] });
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "111");
  const revised = (await actionReceipts(db, user.id, request.id)).find(item => item.status === "PENDING");
  assert.ok(revised && revised.id !== plan.id);
  const confirm = () => executeActionPlan(db, { userId: user.id, requestId: request.id, actionIds: [revised.id] });
  await Promise.all([confirm(), confirm()]);
  assert.equal((await db.contact.findUnique({ where: { id: contact.id } })).phone, "333");
  assert.equal(await db.aiAuditEvent.count({ where: { requestId: request.id, success: true } }), 1);
});
