import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { testDatabase } from './test-db.mjs';
import { nextCoachStep } from '../lib/coach/model.ts';
import { loadCoach, acknowledgeDemo } from '../lib/coach/service.ts';
import { ensureStart, finishIntro, beginCollection, saveName, finishCollection, pauseStart, planCalls } from '../lib/start/service.ts';

const mocks = {
  '@/lib/auth': `export async function requireUser(){return globalThis.emilTestUser} export async function requireUserPerson(id){return globalThis.prisma.person.findUniqueOrThrow({where:{userId:id}})}`,
  'next/cache': 'export function revalidatePath(){}',
  'next/navigation': "export function redirect(url){throw new Error('Redirect '+url)}",
  '@/lib/push': 'export function meldeNebenbei(){}',
};
registerHooks({ resolve(specifier, context, next) { return mocks[specifier] ? { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true } : next(specifier, context); } });
const fixture = await testDatabase();
const db = fixture.client;
globalThis.prisma = db;
after(async () => fixture.close());
const { recordCallResult, recordAppointmentResult, recordAppointmentMissed } = await import('../app/(app)/contacts/results.ts');
const { undoAusfuehren, offenerUndoEintrag } = await import('../lib/undo.ts');
const { wiedervorlageVerschieben } = await import('../lib/followups.ts');
const { bucheZugeordneteEinheiten } = await import('../lib/einheiten-erinnerung.ts');
const { GET: coachGet, POST: coachPost } = await import('../app/api/emil/route.ts');

const empty = { kind: 'VERKAUF', names: 0, collectionOpen: false, collectionId: null, phoneContact: null, callable: null, waitingCall: null, appointment: null, held: null, calls: 0 };
const form = values => { const f = new FormData(); for (const [key, value] of Object.entries(values)) f.set(key, value); return f; };
const enable = () => db.feature.update({ where: { key: 'miniEmil' }, data: { state: 'TEST' } });
async function member(name, kind = 'VERKAUF') {
  const user = await db.user.create({ data: { name, startTrack: kind, person: { create: { name } } } });
  await ensureStart(db, user.id); await finishIntro(db, user.id, false, kind);
  await loadCoach(db, user.id);
  globalThis.emilTestUser = user;
  return user;
}
async function collected(user, name, phone = '0301234567') {
  const round = await beginCollection(db, user.id, user.startTrack);
  const saved = await saveName(db, user.id, { name, kind: user.startTrack, phone, collectionId: round.id, scene: 'familie' });
  await finishCollection(db, user.id, round.id);
  return saved;
}

test('projection respects real work, soft collection target, waiting and missed appointments', () => {
  assert.equal(nextCoachStep(empty).phase, 'COLLECTION');
  assert.equal(nextCoachStep({ ...empty, names: 25, collectionOpen: true }).phase, 'COLLECTION');
  assert.equal(nextCoachStep({ ...empty, names: 1, phoneContact: { id: 'a', name: 'Anna' } }).phase, 'PHONES');
  assert.equal(nextCoachStep({ ...empty, names: 1, callable: { id: 'a', name: 'Anna' } }).phase, 'CALLS');
  const appointment = { id: 'a', name: 'Anna', at: '2030-01-02T12:00:00Z' };
  assert.equal(nextCoachStep({ ...empty, appointment }, new Date('2030-01-01')).waiting, true);
  assert.equal(nextCoachStep({ ...empty, appointment }, new Date('2030-01-03')).phase, 'RESULT');
  assert.equal(nextCoachStep({ ...empty, names: 1, waitingCall: appointment }).phase, 'CALLS');
  assert.equal(nextCoachStep({ ...empty, held: { id: 'a', name: 'Anna', referralsAsked: false, unitsOpen: false } }).phase, 'REFERRALS');
});

test('flag defaults off; active users upgrade, paused stays paused and finished/leader accounts opt in', async () => {
  const old = await db.user.create({ data: { name: 'Emil Legacy', onboardingDoneAt: new Date(), startProgress: { create: { phase: 'DONE' } } } });
  assert.equal(await loadCoach(db, old.id), null);
  await enable();
  assert.equal((await loadCoach(db, old.id)).status, 'available');
  assert.equal((await db.startProgress.findUnique({ where: { userId: old.id } })).version, 1);
  assert.equal((await loadCoach(db, old.id, true)).status, 'active');
  const user = await member('Emil Paused');
  let state = await db.startProgress.findUnique({ where: { userId: user.id } });
  await pauseStart(db, user.id, state.revision);
  assert.equal((await loadCoach(db, user.id)).status, 'paused');
  assert.equal((await loadCoach(db, user.id, true)).status, 'active');
  const leader = await db.user.create({ data: { name: 'Emil Leader', onboardingDoneAt: new Date() } });
  assert.equal((await loadCoach(db, leader.id)).status, 'available');
});

test('previews are idempotent, persist per account and cannot create work', async () => {
  await enable(); const user = await member('Emil Preview');
  await Promise.all([acknowledgeDemo(db, user.id, 'names'), acknowledgeDemo(db, user.id, 'names')]);
  const view = await loadCoach(db, user.id);
  assert.deepEqual(view.seen, ['names']); assert.equal(view.phase, 'COLLECTION');
  assert.equal(await db.contact.count({ where: { ownerId: user.id } }), 0);
  assert.equal(await db.dailyLog.count({ where: { person: { userId: user.id } } }), 0);
  await assert.rejects(acknowledgeDemo(db, user.id, 'invented'));
  const other = await member('Emil Other');
  assert.deepEqual((await loadCoach(db, other.id)).seen, []);
  const round = await beginCollection(db, user.id, 'VERKAUF');
  await finishCollection(db, user.id, round.id);
  assert.equal((await loadCoach(db, user.id)).phase, 'COLLECTION');
  assert.equal((await loadCoach(db, user.id)).status, 'paused');
});

test('real call and appointment actions finish a no-deal round; undo reopens it', async () => {
  await enable(); const user = await member('Emil Real Round');
  const contact = await collected(user, 'Anna Real');
  assert.equal((await loadCoach(db, user.id)).phase, 'CALLS');
  await planCalls(db, user.id, 'VERKAUF', [contact.id], '2030-01-02T12:00');
  assert.equal((await loadCoach(db, user.id)).waiting, true);
  assert.notEqual((await db.startProgress.findUnique({ where: { userId: user.id } })).phase, 'DONE');
  await recordCallResult(form({ contactId: contact.id, result: 'appointment', appointmentAt: '2030-01-02T12:00' }));
  assert.equal((await loadCoach(db, user.id)).phase, 'APPOINTMENT');
  const appointmentFollowUp = await db.contactFollowUp.findFirstOrThrow({
    where: { contactId: contact.id, ownerId: user.id, status: 'OPEN', isPrimary: true },
  });
  await wiedervorlageVerschieben(db, {
    userId: user.id,
    followUpId: appointmentFollowUp.id,
    at: new Date('2020-01-02'),
  });
  await db.contact.update({ where: { id: contact.id }, data: { appointmentAt: new Date('2020-01-02') } });
  assert.equal((await loadCoach(db, user.id)).phase, 'RESULT');
  await recordAppointmentResult(form({ contactId: contact.id, result: 'kein_abschluss' }));
  assert.equal((await loadCoach(db, user.id)).status, 'on-demand');
  const undo = await offenerUndoEintrag(user.id);
  await undoAusfuehren(user.id, undo.id);
  assert.equal((await loadCoach(db, user.id)).phase, 'RESULT');
  await recordAppointmentMissed(form({ contactId: contact.id }));
  const missed = await loadCoach(db, user.id);
  assert.equal(missed.phase, 'CALLS'); assert.equal(missed.waiting, true);
});

test('no-interest and unanswered calls continue; closed deals require their own units and preserve list scope', async () => {
  await enable(); const user = await member('Emil Units', 'RECRUITING');
  const first = await collected(user, 'Emil Contact One');
  const second = await collected(user, 'Emil Contact Two');
  await recordCallResult(form({ contactId: first.id, result: 'no_interest' }));
  assert.match((await loadCoach(db, user.id)).action.href, new RegExp(second.id));
  await recordCallResult(form({ contactId: second.id, result: 'unreachable' }));
  assert.equal((await loadCoach(db, user.id)).waiting, true);
  await recordCallResult(form({ contactId: second.id, result: 'appointment', appointmentAt: '2030-01-02T12:00' }));
  await recordAppointmentResult(form({ contactId: second.id, result: 'abschluss' }));
  assert.equal((await loadCoach(db, user.id)).phase, 'UNITS');
  await db.einheitenbuchung.create({ data: { userId: user.id, hundertstel: 1000, tag: new Date() } });
  assert.equal((await loadCoach(db, user.id)).phase, 'UNITS', 'An unrelated booking must not complete the selected close');
  const reminder = await db.einheitenErinnerung.findFirstOrThrow({ where: { userId: user.id, contactId: second.id } });
  await db.$transaction(tx => bucheZugeordneteEinheiten(tx, { userId: user.id, erinnerungId: reminder.id, hundertstel: 1250, tag: new Date(), notiz: 'Emil test' }));
  assert.equal((await loadCoach(db, user.id)).phase, 'DONE');
  assert.equal((await loadCoach(db, user.id)).kind, 'RECRUITING');
  const other = await member('Emil Scope', 'VERKAUF');
  assert.equal((await loadCoach(db, other.id)).phase, 'COLLECTION');
});

test('background route validates origin and demo, and only acknowledges the authenticated account', async () => {
  const other = await member('Emil API Other');
  const user = await member('Emil API Owner');
  const before = await db.contact.count();
  const request = (origin, body) => new Request('https://crm.example/api/emil', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await coachGet()).headers.get('cache-control'), 'no-store');
  assert.equal((await (await coachGet()).json()).phase, 'COLLECTION');
  assert.equal((await coachPost(request('https://foreign.example', { demo: 'names' }))).status, 403);
  assert.equal((await coachPost(request('https://crm.example', { demo: 'invalid' }))).status, 400);
  assert.equal((await coachPost(request('https://crm.example', { demo: 'names', userId: other.id }))).status, 204);
  assert.deepEqual((await loadCoach(db, user.id)).seen, ['names']);
  assert.deepEqual((await loadCoach(db, other.id)).seen, []);
  assert.equal(await db.contact.count(), before);
});
