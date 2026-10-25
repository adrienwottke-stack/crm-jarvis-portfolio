// In-memory PostgreSQL and locally recorded transport only. No .env or real push provider.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { testDatabase } from "./test-db.mjs";

const fixture = await testDatabase();
const db = fixture.client;
globalThis.prisma = db;
globalThis.releaseDb = db;
globalThis.releasePushTransport = async () => ({ statusCode: 201 });
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "local-test-public";
process.env.VAPID_PRIVATE_KEY = "local-test-private";
const modules = {
  "@/lib/auth": `export async function requireUser(){const u=await globalThis.releaseDb.user.findUnique({where:{id:globalThis.releaseActor??''}}); if(!u||u.deactivatedAt){const e=new Error('login');e.digest='NEXT_REDIRECT;replace;/login;303;';throw e;} return u;}`,
  "web-push": `export default {setVapidDetails(){},sendNotification:(...args)=>globalThis.releasePushTransport(...args)}`,
};
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const { RELEASES } = await import("../lib/releases/catalog.ts");
const { confirmReleasePublication, releaseStateForUser, listPublishedReleases, acknowledgeReleases, recordReleaseEvent, releaseDeliveryReport } = await import("../lib/releases/service.ts");
const { dispatchRelease } = await import("../lib/releases/delivery.ts");
const { sendeMeldung } = await import("../lib/push.ts");
const { aboSpeichern, aboLoeschen } = await import("../app/(app)/pushActions.ts");
const publishRoute = await import("../app/api/releases/publish/route.ts");
const dispatchRoute = await import("../app/api/releases/dispatch/route.ts");
const eventRoute = await import("../app/api/releases/events/route.ts");
const ackRoute = await import("../app/api/releases/acknowledge/route.ts");
const listRoute = await import("../app/api/releases/route.ts");
const releaseId = RELEASES[0].id;
const env = { VERCEL_ENV: "production", VERCEL_DEPLOYMENT_ID: "dpl_local_isolated" };
after(async () => fixture.close());

async function setup() {
  await db.releasePublication.deleteMany();
  await db.releaseAudience.deleteMany();
  await db.user.deleteMany();
  const admin = await db.user.create({ data: { name: "Admin fixture", role: "ADMIN", passwordHash: "fixture", createdAt: new Date("2026-01-01") } });
  const member = await db.user.create({ data: { name: "Member fixture", passwordHash: "fixture", createdAt: new Date("2026-01-01") } });
  globalThis.releaseActor = admin.id;
  globalThis.releasePushTransport = async () => ({ statusCode: 201 });
  const input = { userId: admin.id, releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID };
  return { admin, member, input };
}
const device = (userId, suffix) => db.pushAbo.create({ data: { userId, endpoint: `https://push.example/${suffix}`, p256dh: "p256-test", auth: "auth-test" } });
const publish = input => confirmReleasePublication(db, input, env);
const request = (path, data, origin = "http://localhost") => new Request(`http://localhost/api/releases/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });

test("unpublished catalogue stays hidden; publication freezes users including no-device users and never sends", async () => {
  const s = await setup(); await device(s.member.id, "member"); let calls = 0;
  globalThis.releasePushTransport = async () => { calls++; };
  assert.deepEqual(await listPublishedReleases(db), []);
  await assert.rejects(acknowledgeReleases(db, s.member.id, [releaseId]), e => e.code === "RELEASE_NOT_FOUND");
  await publish(s.input);
  assert.equal(calls, 0);
  assert.equal((await listPublishedReleases(db))[0].id, releaseId);
  assert.equal((await releaseStateForUser(db, s.member.id)).unacknowledgedReleaseIds.length, 1);
  const report = await releaseDeliveryReport(db, releaseId);
  assert.equal(report.selectedUsers, 2); assert.equal(report.usersWithSubscriptionAtSelection, 1);
  await db.user.create({ data: { name: "Later account", passwordHash: "fixture" } });
  await device(s.admin.id, "late-device"); await publish(s.input);
  assert.equal((await releaseDeliveryReport(db, releaseId)).selectedUsers, 2);
  assert.equal(await db.releaseDelivery.count(), 1);
});

test("acknowledgements and event types deduplicate across devices and preserve account boundaries", async () => {
  const s = await setup(); await publish(s.input);
  await Promise.all([acknowledgeReleases(db, s.member.id, [releaseId]), acknowledgeReleases(db, s.member.id, [releaseId])]);
  assert.equal(await db.releaseAcknowledgement.count(), 1);
  assert.deepEqual((await releaseStateForUser(db, s.member.id)).unacknowledgedReleaseIds, []);
  assert.deepEqual((await releaseStateForUser(db, s.admin.id)).unacknowledgedReleaseIds, [releaseId]);
  for (const type of ["IN_APP_VIEWED", "PUSH_OPENED", "ACTION_CLICKED"]) {
    await recordReleaseEvent(db, s.member.id, releaseId, type); await recordReleaseEvent(db, s.member.id, releaseId, type);
  }
  assert.equal(await db.releaseEvent.count(), 3);
  const later = await db.user.create({ data: { name: "New account", passwordHash: "fixture", createdAt: new Date(Date.now() + 10_000) } });
  assert.deepEqual((await releaseStateForUser(db, later.id)).unacknowledgedReleaseIds, []);
  assert.equal((await releaseStateForUser(db, later.id)).releases.length, 1);
});

test("physical account deletion retains the selected release denominator without private account data", async () => {
  const s = await setup(); await device(s.member.id, "deleted-after-selection"); await publish(s.input);
  await db.user.delete({ where: { id: s.member.id } });
  const report = await releaseDeliveryReport(db, releaseId);
  assert.equal(report.selectedUsers, 2); assert.equal(report.usersWithSubscriptionAtSelection, 1);
  assert.equal(report.providerAcceptedUsers, 0);
  const snapshot = await db.releaseAudience.findFirst({ where: { userId: s.member.id } });
  assert.ok(snapshot); assert.equal("name" in snapshot, false);
});

test("history events outside the frozen release audience cannot inflate audience adoption counts", async () => {
  const s = await setup(); await publish(s.input);
  const later = await Promise.all([1, 2].map(index => db.user.create({ data: {
    name: `Later history reader ${index}`, passwordHash: "fixture", createdAt: new Date(Date.now() + 10_000),
  } })));
  for (const user of later) {
    const state = await releaseStateForUser(db, user.id);
    assert.equal(state.releases.length, 1);
    assert.deepEqual(state.unacknowledgedReleaseIds, []);
  }
  for (const user of [s.member, ...later]) for (const type of ["IN_APP_VIEWED", "PUSH_OPENED", "ACTION_CLICKED"]) {
    await recordReleaseEvent(db, user.id, releaseId, type);
  }
  // History remains usable and its events persist; they have a different cohort.
  assert.equal(await db.releaseEvent.count(), 9);
  const report = await releaseDeliveryReport(db, releaseId);
  assert.equal(report.selectedUsers, 2);
  assert.equal(report.inAppViewedUsers, 1);
  assert.equal(report.pushOpenedUsers, 1);
  assert.equal(report.actionClickedUsers, 1);
});

test("missing local release migration hides drafts while unrelated database errors remain visible", async () => {
  const s = await setup();
  const wrap = code => new Proxy(db, { get(target, key) {
    if (key === "releasePublication") return { findMany: async () => { throw { code }; } };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.deepEqual(await listPublishedReleases(wrap("P2021")), []);
  assert.deepEqual(await releaseStateForUser(wrap("P2021"), s.member.id), { releases: [], unacknowledgedReleaseIds: [] });
  await assert.rejects(listPublishedReleases(wrap("P1001")), e => e.code === "P1001");
});

test("production identity and current administrator rights gate publication and dispatch", async () => {
  const s = await setup();
  await assert.rejects(confirmReleasePublication(db, s.input, { ...env, VERCEL_ENV: "preview" }), e => e.code === "PRODUCTION_REQUIRED");
  await assert.rejects(confirmReleasePublication(db, { ...s.input, deploymentId: "different" }, env), e => e.code === "PRODUCTION_REQUIRED");
  await assert.rejects(publish({ ...s.input, userId: s.member.id }), e => e.code === "FORBIDDEN");
  await assert.rejects(dispatchRelease(db, s.input, { env, transport: async () => {} }), e => e.code === "RELEASE_NOT_PUBLISHED");
  await publish(s.input); await db.user.update({ where: { id: s.admin.id }, data: { role: "MEMBER" } });
  await assert.rejects(dispatchRelease(db, s.input, { env, transport: async () => {} }), e => e.code === "FORBIDDEN");
});

test("content drift requires a new release and never displays or dispatches changed content", async () => {
  const s = await setup(); await publish(s.input);
  await db.releasePublication.update({ where: { id: releaseId }, data: { contentHash: "different-content" } });
  assert.deepEqual(await listPublishedReleases(db), []);
  await assert.rejects(publish(s.input), e => e.code === "CONTENT_CHANGED");
  await assert.rejects(dispatchRelease(db, s.input, { env, transport: async () => {} }), e => e.code === "CONTENT_CHANGED");
});

test("parallel dispatch claims each user/device once and measures provider acceptance separately", async () => {
  const s = await setup(); await device(s.member.id, "one"); await device(s.member.id, "two"); await publish(s.input);
  const calls = []; const transport = async (abo, message) => { calls.push(abo.id); assert.match(message.url, /opened=1/); };
  await Promise.all([dispatchRelease(db, s.input, { env, transport }), dispatchRelease(db, s.input, { env, transport })]);
  assert.equal(calls.length, 2); assert.equal(new Set(calls).size, 2);
  await dispatchRelease(db, s.input, { env, transport }); assert.equal(calls.length, 2);
  const report = await releaseDeliveryReport(db, releaseId);
  assert.equal(report.providerAcceptedUsers, 1); assert.equal(report.deviceStatuses.ACCEPTED, 2);
  assert.equal(report.pushOpenedUsers, 0); assert.equal(report.inAppViewedUsers, 0);
});

test("temporary HTTP rejection retries with backoff while accepted and expired devices do not repeat", async () => {
  const s = await setup();
  const good = await device(s.member.id, "good"); const busy = await device(s.member.id, "busy"); const gone = await device(s.member.id, "gone"); await publish(s.input);
  const now = new Date(); const calls = [];
  const transport = async abo => { calls.push(abo.id); if (abo.id === busy.id) throw { statusCode: 503 }; if (abo.id === gone.id) throw { statusCode: 410 }; };
  await dispatchRelease(db, s.input, { env, transport, now });
  assert.ok((await db.pushAbo.findUnique({ where: { id: good.id } })).letzteZustellung);
  assert.equal((await db.pushAbo.findUnique({ where: { id: busy.id } })).letzteZustellung, null);
  assert.equal(await db.pushAbo.findUnique({ where: { id: gone.id } }), null);
  await dispatchRelease(db, s.input, { env, transport, now }); assert.equal(calls.length, 3);
  await dispatchRelease(db, s.input, { env, transport: async abo => calls.push(abo.id), now: new Date(now.getTime() + 61_000) });
  assert.deepEqual(calls, [good.id, busy.id, gone.id, busy.id]);
  assert.equal((await releaseDeliveryReport(db, releaseId)).deviceStatuses.ACCEPTED, 2);
  assert.equal(await db.releaseDelivery.count(), 3);
});

test("retry limit is three and never resends uncertain network or abandoned reserved work", async () => {
  const s = await setup(); const busy = await device(s.member.id, "busy"); const lost = await device(s.member.id, "lost"); const reserved = await device(s.member.id, "reserved"); await publish(s.input);
  const now = new Date(); let calls = 0;
  await db.releaseDelivery.updateMany({ where: { subscriptionId: reserved.id }, data: { status: "RESERVED", reservedAt: new Date(now.getTime() - 360_000), attempts: 1 } });
  const transport = async abo => { calls++; if (abo.id === lost.id) throw new Error("Network timeout"); throw { statusCode: 429 }; };
  for (const offset of [0, 61_000, 182_000, 600_000]) await dispatchRelease(db, s.input, { env, transport, now: new Date(now.getTime() + offset) });
  assert.equal(calls, 4);
  assert.equal((await db.releaseDelivery.findFirst({ where: { subscriptionId: busy.id } })).attempts, 3);
  assert.equal((await releaseDeliveryReport(db, releaseId)).deviceStatuses.UNKNOWN, 2);
  assert.equal((await releaseDeliveryReport(db, releaseId)).retryExhaustedDevices, 1);
});

test("provider acceptance with a lost persistence result stays uncertain and cannot be automatically resent", async () => {
  const s = await setup(); await device(s.member.id, "lost-acceptance-write"); await publish(s.input);
  let failReceipt = true; let calls = 0;
  const delegate = new Proxy(db.releaseDelivery, { get(target, key) {
    if (key === "update") return async args => { if (failReceipt && args.data.status === "ACCEPTED") { failReceipt = false; throw new Error("Receipt persistence interrupted"); } return target.update(args); };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const interruptedDb = new Proxy(db, { get(target, key) { if (key === "releaseDelivery") return delegate; const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } });
  await dispatchRelease(interruptedDb, s.input, { env, transport: async () => { calls++; } });
  await dispatchRelease(db, s.input, { env, transport: async () => { calls++; } });
  assert.equal(calls, 1); assert.equal((await db.releaseDelivery.findFirst()).status, "UNKNOWN");
  assert.equal((await db.pushAbo.findFirst()).letzteZustellung, null);
});

test("account switch rebinds one endpoint and prevents old frozen release sends; logout account cannot delete another owner", async () => {
  const s = await setup(); const abo = await device(s.member.id, "shared-browser"); await publish(s.input);
  globalThis.releaseActor = s.admin.id; await aboSpeichern({ endpoint: abo.endpoint, p256dh: abo.p256dh, auth: abo.auth });
  assert.equal(await db.pushAbo.count(), 1); assert.equal((await db.pushAbo.findUnique({ where: { id: abo.id } })).userId, s.admin.id);
  globalThis.releaseActor = s.member.id; await aboLoeschen(abo.endpoint); assert.equal(await db.pushAbo.count(), 1);
  let calls = 0; await dispatchRelease(db, s.input, { env, transport: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal((await db.releaseDelivery.findFirst()).status, "EXPIRED");
});

test("deactivated recipients are excluded at selection and rechecked before delivery", async () => {
  const s = await setup(); await device(s.member.id, "active-then-disabled");
  await db.user.create({ data: { name: "Disabled before", passwordHash: "fixture", deactivatedAt: new Date() } });
  await publish(s.input); await db.user.update({ where: { id: s.member.id }, data: { deactivatedAt: new Date() } });
  let calls = 0; await dispatchRelease(db, s.input, { env, transport: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal((await releaseDeliveryReport(db, releaseId)).selectedUsers, 2);
  await assert.rejects(acknowledgeReleases(db, s.member.id, [releaseId]), e => e.code === "UNAUTHORIZED");
});

test("empty password hashes are excluded from the frozen audience and rechecked before delivery", async () => {
  const s = await setup();
  const empty = await db.user.create({ data: { name: "Empty-hash placeholder", passwordHash: "", passwordSalt: "fixture" } });
  await device(empty.id, "empty-before-selection");
  await device(s.member.id, "hash-cleared-after-selection");
  await publish(s.input);
  assert.equal((await releaseDeliveryReport(db, releaseId)).selectedUsers, 2);
  assert.equal(await db.releaseAudience.count({ where: { userId: empty.id } }), 0);
  assert.equal(await db.releaseDelivery.count({ where: { userId: empty.id } }), 0);
  await db.user.update({ where: { id: s.member.id }, data: { passwordHash: "" } });
  let calls = 0;
  await dispatchRelease(db, s.input, { env, transport: async () => { calls++; } });
  assert.equal(calls, 0);
  assert.equal((await db.releaseDelivery.findFirst({ where: { userId: s.member.id } })).status, "EXPIRED");
  assert.equal((await releaseDeliveryReport(db, releaseId)).selectedUsers, 2);
});

test("general push updates only accepted snapshots, leaving transient failures without a delivery timestamp", async () => {
  const s = await setup(); const good = await device(s.member.id, "general-good"); const busy = await device(s.member.id, "general-busy");
  globalThis.releasePushTransport = async abo => { if (abo.endpoint === busy.endpoint) throw { statusCode: 503 }; return { statusCode: 201 }; };
  assert.equal(await sendeMeldung([s.member.id], { titel: "Fixture", text: "Test", url: "/heute" }), 1);
  assert.ok((await db.pushAbo.findUnique({ where: { id: good.id } })).letzteZustellung);
  assert.equal((await db.pushAbo.findUnique({ where: { id: busy.id } })).letzteZustellung, null);
});

test("provider cleanup cannot delete a device rebound to another account during transport", async () => {
  const s = await setup(); const abo = await device(s.member.id, "rebind-during-send"); await publish(s.input);
  await dispatchRelease(db, s.input, { env, transport: async () => { await db.pushAbo.update({ where: { id: abo.id }, data: { userId: s.admin.id } }); throw { statusCode: 410 }; } });
  assert.equal((await db.pushAbo.findUnique({ where: { id: abo.id } })).userId, s.admin.id);
});

test("HTTP routes reject cross-origin, forged users, missing confirmations and preview dispatch; GET never sends", async () => {
  const s = await setup(); await device(s.member.id, "route-device");
  process.env.VERCEL_ENV = "preview"; process.env.VERCEL_DEPLOYMENT_ID = env.VERCEL_DEPLOYMENT_ID;
  assert.equal((await publishRoute.POST(request("publish", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID, confirmedSuccessfulProduction: true }, "https://foreign.invalid"))).status, 403);
  assert.equal((await publishRoute.POST(request("publish", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID }))).status, 400);
  assert.equal((await publishRoute.POST(request("publish", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID, confirmedSuccessfulProduction: true }))).status, 403);
  process.env.VERCEL_ENV = "production";
  globalThis.releaseActor = s.member.id;
  assert.equal((await publishRoute.POST(request("publish", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID, confirmedSuccessfulProduction: true }))).status, 403);
  globalThis.releaseActor = s.admin.id;
  assert.equal((await publishRoute.POST(request("publish", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID, confirmedSuccessfulProduction: true }))).status, 200);
  globalThis.releaseActor = s.member.id;
  assert.equal((await eventRoute.POST(request("events", { releaseId, type: "IN_APP_VIEWED", userId: s.admin.id }))).status, 400);
  assert.equal((await ackRoute.POST(request("acknowledge", { releaseIds: [releaseId] }))).status, 200);
  let calls = 0; globalThis.releasePushTransport = async () => { calls++; };
  assert.equal((await listRoute.GET()).status, 200); assert.equal(calls, 0);
  assert.equal((await dispatchRoute.POST(request("dispatch", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID, confirmDispatch: true }))).status, 403);
  globalThis.releaseActor = s.admin.id;
  const response = await dispatchRoute.POST(request("dispatch", { releaseId, deploymentId: env.VERCEL_DEPLOYMENT_ID, confirmDispatch: true }));
  assert.equal(response.status, 200); assert.equal((await response.json()).providerAcceptedUsers, 1); assert.equal(calls, 1);
  globalThis.releaseActor = "missing";
  assert.equal((await listRoute.GET()).status, 401);
});

test("service worker preserves release target/query and refuses cross-origin notification destinations", async () => {
  const listeners = {}; const notifications = []; const destinations = [];
  const context = { URL, self: { location: { origin: "https://crm.example", search: "" }, addEventListener: (type, handler) => { listeners[type] = handler; }, registration: { showNotification: async (title, options) => { notifications.push(options); } }, clients: { matchAll: async () => [], openWindow: async target => { destinations.push(target); } } } };
  runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  let work;
  listeners.push({ data: { json: () => ({ titel: "Fixture", url: `/neuigkeiten?release=${releaseId}&opened=1` }) }, waitUntil: promise => { work = promise; } }); await work;
  listeners.notificationclick({ notification: { data: notifications[0].data, close() {} }, waitUntil: promise => { work = promise; } }); await work;
  assert.equal(destinations[0], `/neuigkeiten?release=${releaseId}&opened=1`);
  listeners.notificationclick({ notification: { data: { url: "https://foreign.invalid" }, close() {} }, waitUntil: promise => { work = promise; } }); await work;
  assert.equal(destinations[1], "/heute");
});
