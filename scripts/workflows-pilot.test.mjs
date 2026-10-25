// Fresh in-memory PostgreSQL; confirmations and provider records are synthetic.
// Does not load .env, contact humans, call providers, or alter an application database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { registerHooks } from "node:module";
import { testDatabase } from "./test-db.mjs";
const fixture = await testDatabase();
const db = fixture.client;
globalThis.workDb = db;
const modules = {
  "@/lib/auth": `export async function requireUser(){const u=await globalThis.workDb.user.findFirst({where:{id:globalThis.workActor??'',deactivatedAt:null}});if(!u){const e=new Error('login');e.digest='NEXT_REDIRECT;replace;/login;303;';throw e}return u}`,
  "@/lib/prisma": `export const prisma=globalThis.workDb`,
  "@/lib/ai-crm/openai": `export function openAiClient(){return globalThis.workModel}`,
  "next/cache": `export function revalidatePath(){}`,
  // Only transport/mapping is tested here; this does not validate audio hardware/container decoding.
  "music-metadata": `export async function parseBuffer(){return {format:{duration:1}}}`,
};
registerHooks({ resolve(specifier, context, next) { return modules[specifier] ? { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const work = await import("../lib/workflows/service.ts");
const { workTaskReport } = await import("../lib/workflows/report.ts");
const pilot = await import("../lib/pilots/service.ts");
const startRoute = await import("../app/api/work-tasks/route.ts");
const completeRoute = await import("../app/api/work-tasks/[taskId]/complete/route.ts");
const cohortRoute = await import("../app/api/work-tasks/contact-cohort/route.ts");
const pilotJoinRoute = await import("../app/api/contact-pilot/join/route.ts");
const chatRoute = await import("../app/api/ai-crm/chat/route.ts");
const liveStartRoute = await import("../app/api/ai-crm/live/session/route.ts");
const liveTurnRoute = await import("../app/api/ai-crm/live/session/[sessionId]/turn/route.ts");
const transcribeRoute = await import("../app/api/ai-crm/transcribe/route.ts");
const now = new Date("2026-10-05T08:00:00Z");
after(async () => { delete process.env.AI_CRM_ENABLED; delete process.env.AI_LIVE_PROVIDER; await fixture.close(); });
async function setup() {
  await db.crmContactPilot.deleteMany(); await db.user.deleteMany();
  const owner = await db.user.create({ data: { name: "Owner fixture", passwordHash: "hash", passwordSalt: "salt", aiBetaEnabled: true, person: { create: { name: `Owner ${randomUUID()}` } } } });
  const foreign = await db.user.create({ data: { name: "Foreign fixture", passwordHash: "hash", passwordSalt: "salt", aiBetaEnabled: true } });
  const contact = await db.contact.create({ data: { name: "Own fixture contact", ownerId: owner.id, createdAt: now } });
  globalThis.workActor = owner.id;
  globalThis.workProviderCalls = 0;
  globalThis.workTranscribeCalls = 0;
  globalThis.workModel = { responses: { async create() { globalThis.workProviderCalls++; return { output: [], output_text: "Synthetic usable contact preparation; no real provider quality claim.", usage: { input_tokens: 4, output_tokens: 6 } }; } },
    audio: { transcriptions: { async create() { globalThis.workTranscribeCalls++; return { text: "Synthetic transcript", usage: { type: "duration", seconds: 1 } }; } } } };
  return { owner, foreign, contact };
}
const start = (s, kind = "RECORD_CONVERSATION", route = "MANUAL", at = now) => work.startWorkTask(db, s.owner.id, { clientTaskId: randomUUID(), kind, route, contactId: s.contact.id }, at);
async function record(s, task, at = new Date(now.getTime() + 60000), options = {}) {
  const activity = await db.activity.create({ data: { contactId: s.contact.id, type: "CALL", text: "Synthetic conversation result", date: at, createdAt: at } });
  const detail = await work.workTaskDetail(db, s.owner.id, task.id, at);
  const input = { version: detail.task.version, proofRevision: detail.proofRevision, resultCorrect: true, activityId: activity.id, nextActionRequired: false, ...options };
  const completed = await work.completeWorkTask(db, s.owner.id, task.id, input, at);
  return { activity, completed, input };
}
async function requestFor(userId, status = "COMPLETED") {
  return db.aiRequest.create({ data: { userId, clientRequestId: randomUUID(), kind: "CHAT", inputHash: "synthetic-hash", status, response: { answer: "Synthetic preparation" }, expiresAt: new Date("2026-11-30") } });
}
const req = (path, data, origin = "http://localhost") => new Request(`http://localhost${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(data) });

test("work starts are idempotent, changed replays/foreign contacts rejected, UUID identifies separate work", async () => {
  const s = await setup(); const input = { clientTaskId: randomUUID(), kind: "PREPARE_CONTACT", route: "MANUAL", contactId: s.contact.id };
  const [a,b] = await Promise.all([work.startWorkTask(db,s.owner.id,input,now), work.startWorkTask(db,s.owner.id,input,now)]);
  assert.equal(a.id,b.id); assert.equal(await db.crmWorkTask.count(),1); assert.equal(await db.crmWorkAttempt.count(),1);
  await assert.rejects(work.startWorkTask(db,s.owner.id,{...input,kind:"RECORD_CONVERSATION"},now),e=>e.code==="WORK_REPLAY_CHANGED");
  await assert.rejects(work.startWorkTask(db,s.foreign.id,{...input,clientTaskId:randomUUID()},now),e=>e.code==="WORK_CONTACT_UNAVAILABLE");
  await start(s,"PREPARE_CONTACT"); assert.equal(await db.crmWorkTask.count(),2);
});
test("completion needs explicit user correctness, a new own activity, and current source revision", async () => {
  const s = await setup();
  const old = await db.activity.create({data:{contactId:s.contact.id,type:"CALL",text:"Old result",createdAt:new Date("2026-10-04"),date:new Date("2026-10-04")}});
  const task = await start(s); const detail = await work.workTaskDetail(db,s.owner.id,task.id,now);
  const input={version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false};
  await assert.rejects(work.completeWorkTask(db,s.owner.id,task.id,{...input,resultCorrect:false},now),e=>e.code==="WORK_CORRECTNESS_REQUIRED");
  await assert.rejects(work.completeWorkTask(db,s.owner.id,task.id,{...input,activityId:old.id},now),e=>e.code==="WORK_RESULT_REQUIRED");
  await db.contact.update({where:{id:s.contact.id},data:{note:"Changed own record"}});
  await assert.rejects(work.completeWorkTask(db,s.owner.id,task.id,input,now),e=>e.code==="WORK_PROOF_CHANGED");
  assert.equal((await db.crmWorkTask.findUnique({where:{id:task.id}})).status,"STARTED");
});
test("concurrent completion and lost response replay count once; one activity cannot finish two tasks", async () => {
  const s=await setup(); const first=await start(s); const second=await start(s);
  const activity=await db.activity.create({data:{contactId:s.contact.id,type:"MEETING",text:"Correct recorded result",date:now,createdAt:now}});
  const detail=await work.workTaskDetail(db,s.owner.id,first.id,now);
  const input={version:0,proofRevision:detail.proofRevision,resultCorrect:true,activityId:activity.id,nextActionRequired:false};
  const [a,b]=await Promise.all([work.completeWorkTask(db,s.owner.id,first.id,input,now),work.completeWorkTask(db,s.owner.id,first.id,input,now)]);
  assert.equal(a.id,b.id); assert.equal(a.version,1); assert.equal(await db.crmWorkTask.count({where:{status:"COMPLETED"}}),1);
  const next=await work.workTaskDetail(db,s.owner.id,second.id,now);
  await assert.rejects(work.completeWorkTask(db,s.owner.id,second.id,{...input,proofRevision:next.proofRevision},now),e=>e.code==="WORK_RESULT_ALREADY_USED");
});
test("required next actions need a current own follow-up; negative outcome requires no artificial follow-up", async () => {
  const s=await setup(); const task=await start(s);
  const activity=await db.activity.create({data:{contactId:s.contact.id,type:"CALL",text:"No interest",date:now,createdAt:now}});
  const follow=await db.contactFollowUp.create({data:{contactId:s.contact.id,ownerId:s.foreign.id,type:"ANRUF",at:new Date("2026-10-06")}});
  const detail=await work.workTaskDetail(db,s.owner.id,task.id,now);
  const input={version:0,proofRevision:detail.proofRevision,resultCorrect:true,activityId:activity.id,nextActionRequired:true,followUpId:follow.id};
  await assert.rejects(work.completeWorkTask(db,s.owner.id,task.id,input,now),e=>e.code==="WORK_NEXT_ACTION_REQUIRED");
  await db.contact.update({where:{id:s.contact.id},data:{outcome:"VERLOREN",lostReason:"KEIN_INTERESSE"}});
  const current=await work.workTaskDetail(db,s.owner.id,task.id,now);
  const completed=await work.completeWorkTask(db,s.owner.id,task.id,{...input,proofRevision:current.proofRevision,nextActionRequired:false,followUpId:undefined},now);
  assert.equal(completed.status,"COMPLETED"); assert.equal(completed.nextActionRequired,false);
});
test("preparation is a separate confirmed result, not a documented real conversation", async () => {
  const s=await setup(); const task=await start(s,"PREPARE_CONTACT"); const detail=await work.workTaskDetail(db,s.owner.id,task.id,now);
  const result=await work.completeWorkTask(db,s.owner.id,task.id,{version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false},now);
  assert.equal(result.kind,"PREPARE_CONTACT");
  await assert.rejects(work.completedConversationProof(db,s.owner.id,task.id),e=>e.code==="WORK_CONFIRMATION_REQUIRED");
});
test("explicit correction counts preserve zero/unknown coverage and are immutable on completion replay", async () => {
  assert.equal(work.workTaskCorrectionCount({proof:{confirmationSource:"USER_REVIEW"}}),null);
  const s=await setup();const task=await start(s,"PREPARE_CONTACT");const detail=await work.workTaskDetail(db,s.owner.id,task.id,now);
  const input={version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false,correctionCount:2};
  for(const count of [-1,101,0.5]) await assert.rejects(work.completeWorkTask(db,s.owner.id,task.id,{...input,correctionCount:count},now),e=>e.code==="WORK_CORRECTION_COUNT_INVALID");
  const completed=await work.completeWorkTask(db,s.owner.id,task.id,input,now);assert.equal(completed.correctionCount,2);
  assert.equal((await work.completeWorkTask(db,s.owner.id,task.id,input,now)).version,1);
  await assert.rejects(work.completeWorkTask(db,s.owner.id,task.id,{...input,correctionCount:null},now),e=>e.code==="WORK_TASK_FINISHED");
  for(const [route,count] of [["MANUAL",0],["MIXED",null]]) {
    const next=await start(s,"PREPARE_CONTACT",route);const proof=await work.workTaskDetail(db,s.owner.id,next.id,now);
    const saved=await work.completeWorkTask(db,s.owner.id,next.id,{version:0,proofRevision:proof.proofRevision,resultCorrect:true,nextActionRequired:false,correctionCount:count},now);
    assert.equal(saved.correctionCount,count);
  }
  const report=await workTaskReport(db,s.owner.id,now);assert.equal(report.tasks.corrections.sum,null);assert.equal(report.tasks.corrections.knownSum,2);
  assert.equal(report.tasks.corrections.knownCompletedTasks,2);assert.equal(report.tasks.corrections.unknownCompletedTasks,1);
  const manual=report.tasks.byKindAndRoute.find(row=>row.kind==="PREPARE_CONTACT"&&row.route==="MANUAL");assert.equal(manual.corrections.sum,2);assert.equal(manual.corrections.coverageComplete,true);
  const mixed=report.tasks.byKindAndRoute.find(row=>row.kind==="PREPARE_CONTACT"&&row.route==="MIXED");assert.equal(mixed.corrections.sum,null);assert.equal(mixed.corrections.knownSum,0);
});
test("attempt replays deduplicate and request/usage ownership cannot be rebound", async () => {
  const s=await setup(); const task=await start(s,"PREPARE_CONTACT","JARVIS"); const other=await start(s,"PREPARE_CONTACT","JARVIS");
  const request=await requestFor(s.owner.id); const foreign=await requestFor(s.foreign.id);
  const usage=await db.aiUsage.create({data:{userId:s.owner.id,requestId:request.id,kind:"CHAT"}});
  await work.bindWorkRequest(db,s.owner.id,task.id,request.id,"CHAT",now);
  await work.bindWorkRequest(db,s.owner.id,task.id,request.id,"CHAT",now);
  assert.equal(await db.crmWorkAttempt.count({where:{taskId:task.id}}),2);
  assert.equal((await db.aiUsage.findUnique({where:{id:usage.id}})).workTaskId,task.id);
  await assert.rejects(work.bindWorkRequest(db,s.owner.id,other.id,request.id,"CHAT"),e=>e.code==="WORK_ATTEMPT_REBOUND");
  await assert.rejects(work.bindWorkRequest(db,s.owner.id,task.id,foreign.id,"CHAT"),e=>e.code==="WORK_REQUEST_UNAVAILABLE");
  const detail=await work.workTaskDetail(db,s.owner.id,task.id,now);
  assert.equal(detail.preparationRequests[0].id,request.id);
  await work.completeWorkTask(db,s.owner.id,task.id,{version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false,preparationRequestId:request.id},now);
  await work.bindWorkRequest(db,s.owner.id,task.id,request.id,"CHAT",now);
  const nextRequest=await requestFor(s.owner.id);
  await assert.rejects(work.bindWorkRequest(db,s.owner.id,task.id,nextRequest.id,"CHAT"),e=>e.code==="WORK_TASK_FINISHED");
});
test("manual-to-mixed transition is explicit; cancellation/error never become success", async () => {
  const s=await setup();const manual=await start(s,"PREPARE_CONTACT");
  await assert.rejects(work.validateAiWorkTask(db,s.owner.id,manual.id),e=>e.code==="WORK_ROUTE_MANUAL");
  const mixed=await work.changeWorkRoute(db,s.owner.id,manual.id,0);assert.equal(mixed.route,"MIXED");assert.equal(mixed.version,1);
  assert.equal((await work.changeWorkRoute(db,s.owner.id,manual.id,0)).version,1);
  await work.finishWorkTask(db,s.owner.id,manual.id,{version:1,status:"FAILED",errorCode:"INCORRECT_RESULT"},now);
  const canceled=await start(s);await work.finishWorkTask(db,s.owner.id,canceled.id,{version:0,status:"CANCELED"},now);
  const report=await workTaskReport(db,s.owner.id,now);assert.equal(report.tasks.completed,0);assert.equal(report.tasks.failed,1);assert.equal(report.tasks.canceled,1);assert.equal(report.tasks.errorClasses.INCORRECT_RESULT,1);
});

test("canceled and failed lost-response replays retain the actual attempt count and original receipt", async () => {
  const s = await setup();
  for (const status of ["CANCELED", "FAILED"]) {
    const task = await start(s, "PREPARE_CONTACT", "JARVIS");
    const request = await requestFor(s.owner.id);
    await work.bindWorkRequest(db, s.owner.id, task.id, request.id, "CHAT", now);
    const input = { version: 0, status, ...(status === "FAILED" ? { errorCode: "INCORRECT_RESULT" } : {}) };
    const first = await work.finishWorkTask(db, s.owner.id, task.id, input, now);
    assert.equal(first.attemptCount, 2);
    const replay = await work.finishWorkTask(db, s.owner.id, task.id, input, new Date(now.getTime() + 60000));
    assert.deepEqual(replay, first);
    assert.equal(await db.crmWorkAttempt.count({ where: { taskId: task.id } }), 2);
    const saved = await db.crmWorkTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(saved.version, 1);
    assert.equal(saved.finishedAt.toISOString(), now.toISOString());
  }
});

test("request binding rejects already assigned costs atomically instead of splitting work and metering", async () => {
  const s = await setup();
  const first = await start(s, "PREPARE_CONTACT", "JARVIS");
  const second = await start(s, "PREPARE_CONTACT", "JARVIS");
  const request = await requestFor(s.owner.id);
  const usage = await db.aiUsage.create({ data: { userId: s.owner.id, requestId: request.id, kind: "CHAT",
    workTaskId: first.id, status: "SUCCEEDED", pricedCostMicros: 2500, providerAttempts: 1, meteringComplete: true } });
  await assert.rejects(work.bindWorkRequest(db, s.owner.id, second.id, request.id, "CHAT", now), error => error.code === "WORK_USAGE_REBOUND");
  assert.equal(await db.crmWorkAttempt.findUnique({ where: { requestId: request.id } }), null);
  assert.equal((await db.aiUsage.findUniqueOrThrow({ where: { id: usage.id } })).workTaskId, first.id);
  await work.bindWorkRequest(db, s.owner.id, first.id, request.id, "CHAT", now);
  assert.equal((await db.crmWorkAttempt.findUniqueOrThrow({ where: { requestId: request.id } })).taskId, first.id);
  const report = await workTaskReport(db, s.owner.id, now);
  assert.equal(report.costs.allAssignedUsageCount, 1);
});
test("deleted or reassigned contact cannot complete, but the user can still cancel their own work", async () => {
  const s=await setup();const task=await start(s);await db.contact.delete({where:{id:s.contact.id}});
  await assert.rejects(work.workTaskDetail(db,s.owner.id,task.id,now),e=>e.code==="WORK_CONTACT_UNAVAILABLE");
  const finished=await work.finishWorkTask(db,s.owner.id,task.id,{version:0,status:"CANCELED"},now);assert.equal(finished.status,"CANCELED");
  assert.equal((await workTaskReport(db,s.owner.id,now)).tasks.canceled,1);
});
test("cost report includes failed attempts; incomplete/unknown metering stays null and never free", async () => {
  const s=await setup(); const task=await start(s,"PREPARE_CONTACT","JARVIS");
  const good=await requestFor(s.owner.id);const bad=await requestFor(s.owner.id,"FAILED");
  for(const request of [good,bad])await work.bindWorkRequest(db,s.owner.id,task.id,request.id,"CHAT",now);
  await db.aiUsage.createMany({data:[{userId:s.owner.id,requestId:good.id,kind:"CHAT",workTaskId:task.id,status:"SUCCEEDED",pricedCostMicros:100,meteringComplete:true,pricingVersion:"fixture"},
    {userId:s.owner.id,requestId:bad.id,kind:"CHAT",workTaskId:task.id,status:"FAILED",pricedCostMicros:40,meteringComplete:true,pricingVersion:"fixture"}]});
  const detail=await work.workTaskDetail(db,s.owner.id,task.id,now);await work.completeWorkTask(db,s.owner.id,task.id,{version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false,preparationRequestId:good.id},now);
  let report=await workTaskReport(db,s.owner.id,now);assert.equal(report.costs.pricedCostMicros,140);assert.equal(report.costs.costPerCompletedTaskMicros,140);assert.equal(report.costs.invoiceVerified,false);
  await db.aiUsage.create({data:{userId:s.owner.id,requestId:randomUUID(),kind:"LIVE_SESSION",workTaskId:task.id,status:"FAILED",estimatedCostMicros:0}});
  report=await workTaskReport(db,s.owner.id,now);assert.equal(report.costs.pricedCostMicros,null);assert.equal(report.costs.unknownUsageCount,1);
});
test("7-day contact denominator is fixed after deletion and immature windows are separate", async () => {
  const s=await setup(); await work.registerContactCohort(db,s.owner.id,s.contact.id,"NEW_ACQUAINTANCE");
  const task=await start(s);await record(s,task,new Date("2026-10-06T08:00:00Z"));await work.confirmFirstContact(db,s.owner.id,task.id,new Date("2026-10-06T09:00:00Z"));
  const young=await db.contact.create({data:{ownerId:s.owner.id,name:"Young fixture",createdAt:new Date("2026-10-10T08:00:00Z")}});
  await work.registerContactCohort(db,s.owner.id,young.id,"FIRST_REFERRAL");
  await assert.rejects(work.registerContactCohort(db,s.owner.id,s.contact.id,"TEST_DEMO"),e=>e.code==="COHORT_FROZEN");
  await db.contact.delete({where:{id:s.contact.id}});
  const report=await workTaskReport(db,s.owner.id,new Date("2026-10-12T08:00:00Z"));assert.equal(report.firstContact7Days.matureContacts,1);assert.equal(report.firstContact7Days.contactedWithin7Days,1);assert.equal(report.firstContact7Days.immatureContacts,1);
});
test("14-day repetition uses first confirmed completion and requires its full follow-up window", async () => {
  const s=await setup(); const first=await start(s,"PREPARE_CONTACT");let d=await work.workTaskDetail(db,s.owner.id,first.id,now);
  await work.completeWorkTask(db,s.owner.id,first.id,{version:0,proofRevision:d.proofRevision,resultCorrect:true,nextActionRequired:false},now);
  const second=await start(s,"PREPARE_CONTACT","MANUAL",new Date("2026-10-07T08:00:00Z"));d=await work.workTaskDetail(db,s.owner.id,second.id,new Date("2026-10-07T08:00:00Z"));
  await work.completeWorkTask(db,s.owner.id,second.id,{version:0,proofRevision:d.proofRevision,resultCorrect:true,nextActionRequired:false},new Date("2026-10-07T08:01:00Z"));
  let report=await workTaskReport(db,s.owner.id,new Date("2026-10-18T08:00:00Z"));assert.equal(report.repeat14Days.maturePeople,0);assert.equal(report.repeat14Days.immaturePeople,1);assert.equal(report.repeat14Days.repeatedPeople,0);
  report=await workTaskReport(db,s.owner.id,new Date("2026-10-19T08:00:00Z"));assert.equal(report.repeat14Days.maturePeople,1);assert.equal(report.repeat14Days.repeatedPeople,1);
});

test("new-contact rate excludes existing contacts and reports origin cohorts separately", async () => {
  const s=await setup();await work.registerContactCohort(db,s.owner.id,s.contact.id,"EXISTING_CONTACT");
  const fresh=await db.contact.create({data:{ownerId:s.owner.id,name:"New acquaintance",createdAt:now}});await work.registerContactCohort(db,s.owner.id,fresh.id,"NEW_ACQUAINTANCE");
  const excluded=await db.contact.create({data:{ownerId:s.owner.id,name:"Demo",createdAt:now}});await work.registerContactCohort(db,s.owner.id,excluded.id,"TEST_DEMO");
  const report=await workTaskReport(db,s.owner.id,new Date("2026-10-12T08:00:00Z"));assert.equal(report.firstContact7Days.matureContacts,1);assert.equal(report.firstContact7Days.byOrigin.find(row=>row.origin==="EXISTING_CONTACT").matureContacts,1);
  assert.equal(report.firstContact7Days.byOrigin.find(row=>row.origin==="TEST_DEMO").excludedContacts,1);assert.equal(report.firstContact7Days.excludedContacts,1);
});

const days=[["2026-10-12","2026-10-14"],["2026-10-19","2026-10-21"]];
async function pilotSetup() {
  const s=await setup();const people=[s.owner,s.foreign];for(let i=2;i<6;i++)people.push(await db.user.create({data:{name:`Participant fixture ${i}`,passwordHash:"hash",passwordSalt:"salt"}}));
  const draft=await pilot.createContactPilot(db,s.owner.id,"2026-10-12",now);return {...s,people,draft};
}
async function joinedPilot() {
  const s=await pilotSetup();for(const person of s.people.slice(0,5))await pilot.joinContactPilot(db,person.id,{joinCode:s.draft.joinCode,consent:true,suitableDays:days},now);
  await pilot.startContactPilot(db,s.owner.id,s.draft.id,now);return s;
}
test("pilot requires own explicit consent, valid future full weeks, and five access-ready accounts", async () => {
  const s=await pilotSetup();await assert.rejects(pilot.createContactPilot(db,s.owner.id,"2026-10-13",now),e=>e.code==="PILOT_FUTURE_WEEKS_REQUIRED");
  await assert.rejects(pilot.joinContactPilot(db,s.foreign.id,{joinCode:s.draft.joinCode,consent:false,suitableDays:days},now),e=>e.code==="PILOT_CONSENT_REQUIRED");
  await assert.rejects(pilot.joinContactPilot(db,s.foreign.id,{joinCode:s.draft.joinCode,consent:true,suitableDays:[["2026-10-12","2026-10-12"],days[1]]},now),e=>e.code==="PILOT_DAYS_REQUIRED");
  for(const person of s.people.slice(0,4))await pilot.joinContactPilot(db,person.id,{joinCode:s.draft.joinCode,consent:true,suitableDays:days},now);
  await assert.rejects(pilot.startContactPilot(db,s.owner.id,s.draft.id,now),e=>e.code==="PILOT_FIVE_CONSENTS_REQUIRED");
  await pilot.joinContactPilot(db,s.people[4].id,{joinCode:s.draft.joinCode,consent:true,suitableDays:days},now);
  await db.user.update({where:{id:s.people[4].id},data:{deactivatedAt:now}});
  await assert.rejects(pilot.startContactPilot(db,s.owner.id,s.draft.id,now),e=>e.code==="PILOT_ACCOUNT_NOT_READY");
});
test("simultaneous joins select exactly five; participant days and selected denominator freeze at start", async () => {
  const s=await pilotSetup();const outcomes=await Promise.allSettled(s.people.map(person=>pilot.joinContactPilot(db,person.id,{joinCode:s.draft.joinCode,consent:true,suitableDays:days},now)));
  assert.equal(outcomes.filter(row=>row.status==="fulfilled").length,5);assert.equal(await db.crmPilotParticipant.count(),5);
  await pilot.startContactPilot(db,s.owner.id,s.draft.id,now);
  const me=await db.crmPilotParticipant.findFirst({where:{pilotId:s.draft.id}});
  await assert.rejects(pilot.scheduleContactPilot(db,me.userId,s.draft.id,days,now),e=>e.code==="PILOT_SCHEDULE_FROZEN");
  const detail=await pilot.contactPilotDetail(db,me.userId,s.draft.id,now);assert.equal(detail.report.denominator,5);assert.equal(detail.report.decision,"PENDING");
});
test("pilot draft never becomes a completed experiment solely because calendar time passes", async () => {
  const s=await pilotSetup();const detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,new Date("2026-11-01"));
  assert.equal(detail.report.decision,"NOT_STARTED");assert.equal(detail.report.fullyObserved,false);assert.equal(detail.report.denominator,null);
  await assert.rejects(pilot.startContactPilot(db,s.owner.id,s.draft.id,new Date("2026-10-12T08:00:00Z")),e=>e.code==="PILOT_START_CLOSED");
});
test("pilot conversation requires own completed work/current evidence and keeps real-conversation confirmation separate", async () => {
  const s=await joinedPilot(); const at=new Date("2026-10-12T08:00:00Z");const task=await start(s,"RECORD_CONVERSATION","MANUAL",at);
  const row=await record(s,task,new Date("2026-10-12T08:01:00Z"));
  const input={action:"CONVERSATION",taskId:task.id,conversationKind:"EXISTING_CONTACT",conversationConfirmed:false};
  await assert.rejects(pilot.recordPilotFeedback(db,s.foreign.id,s.draft.id,input,at),e=>e.code==="WORK_TASK_NOT_FOUND");
  await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,new Date("2026-10-12T08:02:00Z"));
  await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,new Date("2026-10-12T08:02:00Z"));assert.equal(await db.crmPilotObservation.count(),1);
  let detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,new Date("2026-10-12T08:02:00Z"));assert.equal(detail.report.confirmedConversationCount,0);assert.equal(detail.report.unconfirmed,1);
  await db.activity.update({where:{id:row.activity.id},data:{text:"Edited after confirmation"}});
  await assert.rejects(pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,new Date("2026-10-12T08:03:00Z")),e=>e.code==="WORK_PROOF_CHANGED");
});
test("deleting coordinator or participant keeps immutable five-person denominator and does not infer review", async () => {
  const s=await joinedPilot();await db.user.delete({where:{id:s.owner.id}});await db.user.delete({where:{id:s.people[2].id}});
  const detail=await pilot.contactPilotDetail(db,s.foreign.id,s.draft.id,new Date("2026-10-26T08:00:00Z"));
  assert.equal(detail.report.denominator,5);assert.equal(detail.report.decision,"PENDING");assert.equal(detail.report.fullyObserved,false);assert.equal(detail.pilot.participantCount,5);
  await assert.rejects(pilot.reviewContactPilot(db,s.foreign.id,s.draft.id,new Date("2026-10-26T08:00:00Z")),e=>e.code==="PILOT_NOT_FOUND");
});

test("pilot conversation feedback cannot bypass frozen test duplicate or import exclusions", async () => {
  const s = await joinedPilot();
  const at = new Date("2026-10-12T08:00:00Z");
  for (const origin of ["TEST_DEMO", "DUPLICATE", "IMPORT"]) {
    const contact = await db.contact.create({ data: { ownerId: s.owner.id, name: `Excluded ${origin}`, createdAt: now } });
    const state = { ...s, contact };
    await work.registerContactCohort(db, s.owner.id, contact.id, origin);
    const task = await start(state, "RECORD_CONVERSATION", "MANUAL", at);
    await record(state, task, new Date(at.getTime() + 60000));
    await assert.rejects(pilot.recordPilotFeedback(db, s.owner.id, s.draft.id,
      { action: "CONVERSATION", taskId: task.id, conversationKind: "NEW_ACQUAINTANCE", conversationConfirmed: true },
      new Date(at.getTime() + 120000)), error => error.code === "PILOT_CONTACT_EXCLUDED");
    const cohort = await work.contactCohortForUser(db, s.owner.id, contact.id);
    assert.equal(cohort.eligible, false); assert.equal(cohort.firstConfirmedContactAt, null);
  }
  assert.equal(await db.crmPilotObservation.count(), 0);
  // Ordinary owned conversation work remains usable without a new mandatory classification step.
  const task = await start(s, "RECORD_CONVERSATION", "MANUAL", at);
  await record(s, task, new Date(at.getTime() + 60000));
  await pilot.recordPilotFeedback(db, s.owner.id, s.draft.id,
    { action: "CONVERSATION", taskId: task.id, conversationKind: "EXISTING_CONTACT", conversationConfirmed: true }, new Date(at.getTime() + 120000));
  assert.equal((await pilot.contactPilotDetail(db, s.owner.id, s.draft.id, new Date(at.getTime() + 120000))).report.confirmedConversationCount, 1);
});

test("pilot first-encounter classification preserves the frozen origin while allowing later existing conversations", async () => {
  const s = await joinedPilot();
  const firstAt = new Date("2026-10-12T08:00:00Z");
  for (const [origin, contradictoryKind] of [["EXISTING_CONTACT", "NEW_ACQUAINTANCE"], ["EXISTING_CONTACT", "FIRST_REFERRAL"],
    ["NEW_ACQUAINTANCE", "FIRST_REFERRAL"], ["FIRST_REFERRAL", "NEW_ACQUAINTANCE"]]) {
    const contact = await db.contact.create({ data: { ownerId: s.owner.id, name: `Frozen ${origin} ${contradictoryKind}`, createdAt: now } });
    const state = { ...s, contact };
    await work.registerContactCohort(db, s.owner.id, contact.id, origin);
    const task = await start(state, "RECORD_CONVERSATION", "MANUAL", firstAt);
    await record(state, task, new Date(firstAt.getTime() + 60000));
    await assert.rejects(pilot.recordPilotFeedback(db, s.owner.id, s.draft.id,
      { action: "CONVERSATION", taskId: task.id, conversationKind: contradictoryKind, conversationConfirmed: true },
      new Date(firstAt.getTime() + 120000)), error => error.code === "PILOT_CONTACT_ORIGIN_CONFLICT");
    await pilot.recordPilotFeedback(db, s.owner.id, s.draft.id,
      { action: "CONVERSATION", taskId: task.id, conversationKind: origin, conversationConfirmed: true }, new Date(firstAt.getTime() + 120000));
    const laterAt = new Date("2026-10-19T08:00:00Z");
    const laterTask = await start(state, "RECORD_CONVERSATION", "MANUAL", laterAt);
    await record(state, laterTask, new Date(laterAt.getTime() + 60000));
    await pilot.recordPilotFeedback(db, s.owner.id, s.draft.id,
      { action: "CONVERSATION", taskId: laterTask.id, conversationKind: "EXISTING_CONTACT", conversationConfirmed: true }, new Date(laterAt.getTime() + 120000));
  }
  const detail = await pilot.contactPilotDetail(db, s.owner.id, s.draft.id, new Date("2026-10-26T08:00:00Z"));
  assert.deepEqual(detail.report.uniqueFirstEncounters.map(row => [row.newAcquaintances, row.firstReferrals, row.existingContactConversations]), [[1, 1, 2], [0, 0, 4]]);
});
test("three of five qualify only after both full weeks and explicit coordinator data review", async () => {
  const s=await joinedPilot();
  for(const person of s.people.slice(0,3)) {
    const contact=await db.contact.create({data:{name:"Scoped pilot fixture",ownerId:person.id,createdAt:now}});
    for(const day of days.flat()) {
      const state={owner:person,contact};const at=new Date(`${day}T08:00:00Z`);const task=await start(state,"RECORD_CONVERSATION","MANUAL",at);await record(state,task,new Date(at.getTime()+60000));
      await pilot.recordPilotFeedback(db,person.id,s.draft.id,{action:"CONVERSATION",taskId:task.id,conversationKind:"NEW_ACQUAINTANCE",conversationConfirmed:true},new Date(at.getTime()+120000));
    }
  }
  const lastSundayBerlin=new Date("2026-10-25T22:30:00Z");let detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,lastSundayBerlin);assert.equal(detail.report.windowElapsed,false);assert.equal(detail.report.qualified,3);assert.equal(detail.report.decision,"PENDING");
  await assert.rejects(pilot.reviewContactPilot(db,s.owner.id,s.draft.id,lastSundayBerlin),e=>e.code==="PILOT_REVIEW_NOT_READY");
  const end=new Date("2026-10-25T23:00:00Z");detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,end);assert.equal(detail.report.windowElapsed,true);assert.equal(detail.report.decision,"PENDING");
  await pilot.reviewContactPilot(db,s.owner.id,s.draft.id,end);detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,end);assert.equal(detail.report.decision,"THRESHOLD_MET");assert.equal(detail.report.denominator,5);assert.equal(detail.report.fullyObserved,true);
});
test("first encounters deduplicate own contacts across both weeks, retain snapshots and reject changed first class", async () => {
  const s=await joinedPilot();
  for(const [day,kind] of [["2026-10-12","NEW_ACQUAINTANCE"],["2026-10-14","NEW_ACQUAINTANCE"],["2026-10-19","NEW_ACQUAINTANCE"],["2026-10-21","EXISTING_CONTACT"]]) {
    const at=new Date(`${day}T08:00:00Z`);const task=await start(s,"RECORD_CONVERSATION","MANUAL",at);await record(s,task,new Date(at.getTime()+60000));
    await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,{action:"CONVERSATION",taskId:task.id,conversationKind:kind,conversationConfirmed:true},new Date(at.getTime()+120000));
  }
  const at=new Date("2026-10-22T08:00:00Z");const conflict=await start(s,"RECORD_CONVERSATION","MANUAL",at);await record(s,conflict,new Date(at.getTime()+60000));
  await assert.rejects(pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,{action:"CONVERSATION",taskId:conflict.id,conversationKind:"FIRST_REFERRAL",conversationConfirmed:true},new Date(at.getTime()+120000)),e=>e.code==="PILOT_FIRST_ENCOUNTER_CONFLICT");
  let detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,new Date("2026-10-26T08:00:00Z"));
  assert.equal(detail.report.qualified,1);assert.equal(detail.report.conversationKinds[0].NEW_ACQUAINTANCE,2);assert.equal(detail.report.conversationKinds[1].NEW_ACQUAINTANCE,1);
  assert.deepEqual(detail.report.uniqueFirstEncounters.map(row=>[row.newAcquaintances,row.firstReferrals,row.existingContactConversations]),[[1,0,0],[0,0,1]]);
  const snapshots=await db.crmPilotObservation.findMany({where:{kind:"CONVERSATION"}});assert.equal(new Set(snapshots.map(row=>row.contactKey)).size,1);assert.match(snapshots[0].contactKey,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(detail.report).includes(s.contact.id));assert.ok(!JSON.stringify(detail.report).includes(snapshots[0].contactKey));
  await db.contact.delete({where:{id:s.contact.id}});await db.user.delete({where:{id:s.owner.id}});
  detail=await pilot.contactPilotDetail(db,s.foreign.id,s.draft.id,new Date("2026-10-26T08:00:00Z"));assert.equal(detail.report.denominator,5);assert.equal(detail.report.uniqueFirstEncounters[0].newAcquaintances,1);
});
test("legacy unidentified first-encounter evidence stays unknown instead of inflating unique people", async () => {
  const s=await joinedPilot();const participant=await db.crmPilotParticipant.findUnique({where:{pilotId_userId:{pilotId:s.draft.id,userId:s.owner.id}}});
  await db.crmPilotObservation.create({data:{pilotId:s.draft.id,participantId:participant.id,kind:"CONVERSATION",conversationKind:"FIRST_REFERRAL",conversationConfirmed:true,resultCorrect:true,occurredAt:new Date("2026-10-12T08:00:00Z")}});
  const detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,new Date("2026-10-26T08:00:00Z"));
  assert.equal(detail.report.conversationKinds[0].FIRST_REFERRAL,1);
  for(const week of detail.report.uniqueFirstEncounters) {assert.equal(week.newAcquaintances,null);assert.equal(week.firstReferrals,null);assert.equal(week.unknownEvidenceConversations,1);assert.equal(week.evidenceComplete,false);}
});
test("weekly review waits for full week and deduplicates; outsiders cannot read pilot", async () => {
  const s=await joinedPilot();await assert.rejects(pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,{action:"WEEK_REVIEW",week:1},new Date("2026-10-16")),e=>e.code==="PILOT_WEEK_NOT_COMPLETE");
  for(let i=0;i<2;i++)await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,{action:"WEEK_REVIEW",week:1},new Date("2026-10-19T08:00:00Z"));
  await assert.rejects(pilot.contactPilotDetail(db,s.people[5].id,s.draft.id,now),e=>e.code==="PILOT_NOT_FOUND");
  const detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,new Date("2026-10-19T08:00:00Z"));assert.deepEqual(detail.report.completedWeeklyReviews,[1,0]);
});
test("preparation round feedback is explicit and deduplicated before pilot, never qualifies a conversation", async () => {
  const s=await pilotSetup();await pilot.joinContactPilot(db,s.owner.id,{joinCode:s.draft.joinCode,consent:true,suitableDays:days},now);
  const input={action:"HURDLE",hurdle:"BLOCK_NOT_STARTED",clientObservationId:randomUUID(),roundObserved:true};
  await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,now);await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,now);
  const detail=await pilot.contactPilotDetail(db,s.owner.id,s.draft.id,now);assert.equal(detail.report.preparationObservationCount,1);assert.equal(detail.report.confirmedConversationCount,0);assert.equal(detail.report.decision,"NOT_STARTED");
  await assert.rejects(pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,{...input,roundObserved:false},now),e=>e.code==="PILOT_ROUND_CONFIRMATION_REQUIRED");
});
test("a preparation hurdle replay across the first pilot day retains its original receipt", async () => {
  const s=await joinedPilot();const input={action:"HURDLE",hurdle:"TECHNICAL",clientObservationId:randomUUID(),roundObserved:true};
  const first=await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,now);
  const replay=await pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,input,new Date("2026-10-12T08:00:00Z"));
  assert.equal(first.id,replay.id);assert.equal(await db.crmPilotObservation.count(),1);
  assert.equal((await db.crmPilotObservation.findUnique({where:{id:first.id}})).kind,"PREPARATION_HURDLE");
  await assert.rejects(pilot.recordPilotFeedback(db,s.owner.id,s.draft.id,{...input,hurdle:"FIND_CONTACT"},new Date("2026-10-12T08:00:00Z")),e=>e.code==="PILOT_OBSERVATION_REPLAY_CHANGED");
});
test("voluntary leave removes draft participation but keeps frozen denominator and prevents further feedback", async () => {
  const before=await pilotSetup();await pilot.joinContactPilot(db,before.foreign.id,{joinCode:before.draft.joinCode,consent:true,suitableDays:days},now);
  const left=await pilot.leaveContactPilot(db,before.foreign.id,before.draft.id,now);assert.equal(left.denominatorPreserved,false);assert.equal(await db.crmPilotParticipant.count(),0);
  const s=await joinedPilot();const at=new Date("2026-10-12T08:00:00Z");await pilot.leaveContactPilot(db,s.foreign.id,s.draft.id,at);
  const detail=await pilot.contactPilotDetail(db,s.foreign.id,s.draft.id,at);assert.equal(detail.report.denominator,5);assert.equal(detail.report.withdrawnParticipantCount,1);assert.ok(detail.pilot.myParticipant.withdrawnAt);
  await assert.rejects(pilot.recordPilotFeedback(db,s.foreign.id,s.draft.id,{action:"HURDLE",hurdle:"TECHNICAL",clientObservationId:randomUUID(),roundObserved:true},at),e=>e.code==="PILOT_PARTICIPATION_REQUIRED");
});
test("work/pilot APIs reject cross-origin, unconfirmed input, foreign ownership and unsigned actor", async () => {
  const s=await setup();const input={clientTaskId:randomUUID(),kind:"PREPARE_CONTACT",route:"MANUAL",contactId:s.contact.id};
  const ownCohortRequest=()=>new Request(`http://localhost/api/work-tasks/contact-cohort?contactId=${s.contact.id}`);
  assert.deepEqual(await (await cohortRoute.GET(ownCohortRequest())).json(),{cohort:null});
  assert.equal((await cohortRoute.POST(req("/api/work-tasks/contact-cohort",{action:"REGISTER",contactId:s.contact.id,origin:"NEW_ACQUAINTANCE"}))).status,200);
  const ownCohort=await (await cohortRoute.GET(ownCohortRequest())).json();assert.equal(ownCohort.cohort.origin,"NEW_ACQUAINTANCE");assert.equal(ownCohort.cohort.eligible,true);
  assert.equal((await startRoute.POST(req("/api/work-tasks",input,"https://foreign.example"))).status,403);
  assert.equal((await startRoute.POST(req("/api/work-tasks",{...input,userId:s.foreign.id}))).status,400);
  const created=await startRoute.POST(req("/api/work-tasks",input));assert.equal(created.status,200);const {task}=await created.json();
  const detail=await work.workTaskDetail(db,s.owner.id,task.id);const ctx={params:Promise.resolve({taskId:task.id})};
  for(const correctionCount of [-1,101,1.5,"1"]) assert.equal((await completeRoute.POST(req(`/api/work-tasks/${task.id}/complete`,{version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false,correctionCount}),ctx)).status,400);
  assert.equal((await completeRoute.POST(req(`/api/work-tasks/${task.id}/complete`,{version:0,proofRevision:detail.proofRevision,resultCorrect:false,nextActionRequired:false}),ctx)).status,400);
  globalThis.workActor=s.foreign.id;assert.equal((await completeRoute.POST(req(`/api/work-tasks/${task.id}/complete`,{version:0,proofRevision:detail.proofRevision,resultCorrect:true,nextActionRequired:false}),ctx)).status,404);
  assert.equal((await cohortRoute.GET(ownCohortRequest())).status,404);
  assert.equal((await pilotJoinRoute.POST(req("/api/contact-pilot/join",{joinCode:"synthetic",consent:false,suitableDays:days}))).status,400);
  globalThis.workActor="missing";assert.equal((await startRoute.POST(req("/api/work-tasks",input))).status,401);assert.equal((await cohortRoute.GET(ownCohortRequest())).status,401);
});
async function enableAi() {
  process.env.AI_CRM_ENABLED="true";process.env.AI_LIVE_PROVIDER="mock";
  await db.feature.upsert({where:{key:"aiCrm"},create:{key:"aiCrm",titel:"Isolated work API",state:"TEST"},update:{state:"TEST"}});
}
test("actual chat route binds own work, persists reload preparation and replays without extra attempts/cost", async () => {
  const s=await setup();await enableAi();const task=await start(s,"PREPARE_CONTACT","JARVIS",new Date());
  const body={message:"Bereite meinen ausgewählten Kontakt vor.",source:"text",clientRequestId:randomUUID(),workTaskId:task.id};
  const first=await chatRoute.POST(req("/api/ai-crm/chat",body));assert.equal(first.status,200);const output=await first.json();assert.ok(output.requestId);
  assert.equal((await db.aiRequest.findUnique({where:{id:output.requestId}})).status,"COMPLETED");
  const replay=await chatRoute.POST(req("/api/ai-crm/chat",body));assert.equal(replay.status,200);assert.equal(replay.headers.get("X-AI-Replayed"),"1");assert.equal(globalThis.workProviderCalls,1);
  assert.equal(await db.crmWorkAttempt.count({where:{taskId:task.id}}),2);assert.equal(await db.aiUsage.count({where:{workTaskId:task.id}}),1);
  const detail=await work.workTaskDetail(db,s.owner.id,task.id);assert.equal(detail.preparationRequests[0].id,output.requestId);
  await work.completeWorkTask(db,s.owner.id,task.id,{version:0,proofRevision:detail.proofRevision,resultCorrect:true,preparationRequestId:output.requestId,nextActionRequired:false});
  const completedReplay=await chatRoute.POST(req("/api/ai-crm/chat",body));assert.equal(completedReplay.status,200);assert.equal(globalThis.workProviderCalls,1);
});
test("actual chat route rejects foreign/manual/mismatched work before provider and tracks failed assigned calls", async () => {
  const s=await setup();await enableAi();const task=await start(s,"PREPARE_CONTACT","MANUAL",new Date());
  const body={message:"Bereite den Kontakt vor.",source:"text",clientRequestId:randomUUID(),workTaskId:task.id};
  assert.equal((await chatRoute.POST(req("/api/ai-crm/chat",body))).status,409);assert.equal(globalThis.workProviderCalls,0);
  await work.changeWorkRoute(db,s.owner.id,task.id,0);globalThis.workActor=s.foreign.id;
  assert.equal((await chatRoute.POST(req("/api/ai-crm/chat",body))).status,404);globalThis.workActor=s.owner.id;
  const another=await db.contact.create({data:{ownerId:s.owner.id,name:"Other own fixture"}});
  assert.equal((await chatRoute.POST(req("/api/ai-crm/chat",{...body,context:{contactId:another.id}}))).status,409);assert.equal(globalThis.workProviderCalls,0);
  globalThis.workModel.responses.create=async()=>{globalThis.workProviderCalls++;throw new Error("local recorded provider failure")};
  assert.equal((await chatRoute.POST(req("/api/ai-crm/chat",body))).status,500);
  const usage=await db.aiUsage.findFirst({where:{workTaskId:task.id}});assert.ok(usage);assert.equal(usage.status,"FAILED");assert.equal(usage.pricedCostMicros,null);assert.equal(usage.meteringComplete,false);
  assert.equal((await db.crmWorkTask.findUnique({where:{id:task.id}})).status,"STARTED");
});
test("actual mock Live routes preserve session cost ownership, reject rebind and deduplicate turn replay", async () => {
  const s=await setup();await enableAi();const task=await start(s,"PREPARE_CONTACT","JARVIS",new Date());const other=await start(s,"PREPARE_CONTACT","JARVIS",new Date());
  const startBody={clientSessionId:randomUUID(),workTaskId:task.id};const response=await liveStartRoute.POST(req("/api/ai-crm/live/session",startBody));assert.equal(response.status,200);const output=await response.json();const sessionId=output.session.id;
  const session=await db.aiLiveSession.findUnique({where:{id:sessionId}});assert.equal((await db.aiUsage.findUnique({where:{id:session.usageId}})).workTaskId,task.id);
  const rebind=await liveStartRoute.POST(req("/api/ai-crm/live/session",{...startBody,workTaskId:other.id}));assert.equal(rebind.status,409);
  const turnBody={clientTurnId:randomUUID(),transcript:"Was ist heute offen?",workTaskId:task.id};const ctx={params:Promise.resolve({sessionId})};
  const turn=await liveTurnRoute.POST(req(`/api/ai-crm/live/session/${sessionId}/turn`,turnBody),ctx);assert.equal(turn.status,200);
  const replay=await liveTurnRoute.POST(req(`/api/ai-crm/live/session/${sessionId}/turn`,turnBody),ctx);assert.equal(replay.status,200);assert.equal(replay.headers.get("X-AI-Replayed"),"1");
  assert.equal(await db.crmWorkAttempt.count({where:{taskId:task.id}}),3);assert.equal(await db.aiUsage.count({where:{workTaskId:task.id}}),1);
  const wrong=await liveTurnRoute.POST(req(`/api/ai-crm/live/session/${sessionId}/turn`,{...turnBody,clientTurnId:randomUUID(),workTaskId:other.id}),ctx);assert.equal(wrong.status,409);
  assert.equal(globalThis.workProviderCalls,0);assert.equal((await workTaskReport(db,s.owner.id)).costs.pricedCostMicros,null);
});
test("actual transcription route binds owned work and meters one unknown-price attempt, replay is free of new calls", async () => {
  const s=await setup();await enableAi();const task=await start(s,"PREPARE_CONTACT","JARVIS",new Date());const clientRequestId=randomUUID();
  const audioRequest=()=>{const data=new FormData();data.set("audio",new File([new Uint8Array(16)],"synthetic.webm",{type:"audio/webm"}));data.set("clientRequestId",clientRequestId);data.set("durationSeconds","1");data.set("workTaskId",task.id);return new Request("http://localhost/api/ai-crm/transcribe",{method:"POST",headers:{origin:"http://localhost"},body:data})};
  const result=await transcribeRoute.POST(audioRequest());assert.equal(result.status,200);const replay=await transcribeRoute.POST(audioRequest());assert.equal(replay.status,200);assert.equal(globalThis.workTranscribeCalls,1);
  const usage=await db.aiUsage.findFirst({where:{workTaskId:task.id,kind:"TRANSCRIPTION"}});assert.equal(usage.providerAttempts,1);assert.equal(usage.pricedCostMicros,null);assert.equal(usage.meteringComplete,false);
  assert.equal(await db.crmWorkAttempt.count({where:{taskId:task.id}}),2);
  globalThis.workActor=s.foreign.id;assert.equal((await transcribeRoute.POST(audioRequest())).status,404);assert.equal(globalThis.workTranscribeCalls,1);
});
