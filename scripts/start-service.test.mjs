import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testDatabase } from './start-test-db.mjs';
import { ensureStart, finishIntro, beginCollection, saveName, collectionView, moveScene, finishCollection } from '../lib/start/service.ts';
import { saveStartPhone, finishPhones, prepareCalls, planCalls, chooseStorno, advanceIntro, answerIntro, pauseStart, resumeStart, moveCollection, beginSprint } from '../lib/start/service.ts';

test('career setup resumes after contact rating and is safe to acknowledge twice', async () => {
  const fixture = await testDatabase(); const db = fixture.client;
  try {
    const user = await db.user.create({ data: { name: 'Career Setup', startTrack: 'VERKAUF' } });
    await ensureStart(db, user.id);
    await db.startProgress.update({ where: { userId: user.id }, data: { introAct: 'einstufung' } });
    await advanceIntro(db, user.id, 'einstufung');
    assert.equal((await ensureStart(db, user.id)).introAct, 'karrierestufe');
    await advanceIntro(db, user.id, 'karrierestufe');
    await advanceIntro(db, user.id, 'karrierestufe');
    assert.equal((await ensureStart(db, user.id)).introAct, 'rangliste');
    const account = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(account.karrierestufe, null, 'A checkpoint never invents a career level');
    assert.equal(account.einheitenStart, 0, 'A checkpoint never books opening units');
  } finally { await fixture.close(); }
});

test('an unactivated invitation placeholder does not switch a new member to leader onboarding', async () => {
  const fixture = await testDatabase(); const db = fixture.client;
  try {
    const user = await db.user.create({ data: { name: 'New Partner' } });
    await db.user.create({ data: { name: 'Invitation Placeholder', leaderId: user.id } });
    assert.equal((await ensureStart(db, user.id)).phase, 'INTRO');
    const leader = await db.user.create({ data: { name: 'Activated Team Leader' } });
    await db.user.create({ data: { name: 'Activated Partner', leaderId: leader.id, passwordHash: 'fixture-access' } });
    assert.equal(await ensureStart(db, leader.id), null);
  } finally { await fixture.close(); }
});

test('pausing, stale tabs, list correction and existing appointments preserve user intent', async()=>{
  const fixture=await testDatabase();const db=fixture.client;
  try {
    const user=await db.user.create({data:{name:'Pause Test',person:{create:{name:'Pause Test'}}}});
    await ensureStart(db,user.id);
    await db.startProgress.update({where:{userId:user.id},data:{introAct:'sprint'}});
    const sprint=await beginSprint(db,user.id);
    assert.equal((await beginSprint(db,user.id)).sprintEndAt.toISOString(),sprint.sprintEndAt.toISOString());
    await finishIntro(db,user.id,false,'RECRUITING');
    const round=await beginCollection(db,user.id,'RECRUITING');
    const saved=await saveName(db,user.id,{name:'Lara',kind:'RECRUITING',key:'lara',collectionId:round.id,scene:'familie'});
    await assert.rejects(saveName(db,user.id,{name:'Andere',kind:'RECRUITING',key:'lara'}),/anderen Eingabe/);
    await moveScene(db,user.id,round.id,0,'freunde');
    await assert.rejects(moveScene(db,user.id,round.id,0,'nachbarn'),/geändert/);
    const state=await ensureStart(db,user.id);
    await pauseStart(db,user.id,state.revision);
    await assert.rejects(pauseStart(db,user.id,state.revision),/geändert/);
    assert.equal((await resumeStart(db,user.id)).paused,false);
    await finishCollection(db,user.id,round.id);
    await moveCollection(db,user.id,round.id,'VERKAUF');
    await moveCollection(db,user.id,round.id,'VERKAUF');
    assert.equal((await ensureStart(db,user.id)).kind,'VERKAUF');
    assert.deepEqual((await db.contact.findUnique({where:{id:saved.id}})).listKinds,['VERKAUF']);
    await saveStartPhone(db,user.id,'VERKAUF',saved.id,null);
    assert.equal((await finishPhones(db,user.id,'VERKAUF')).paused,true);
    assert.deepEqual((await resumeStart(db,user.id)).phoneSkipped,[]);
    await saveStartPhone(db,user.id,'VERKAUF',saved.id,'0301234567');
    const scheduledAt=new Date('2030-09-10T10:00:00Z');
    await db.contact.update({where:{id:saved.id},data:{nextStepType:'TERMIN',nextStepAt:scheduledAt}});
    await planCalls(db,user.id,'VERKAUF',[saved.id],'2030-09-10T16:00');
    const preserved=await db.contact.findUnique({where:{id:saved.id}});
    assert.equal(preserved.nextStepType,'TERMIN');assert.equal(preserved.nextStepAt.toISOString(),scheduledAt.toISOString());
    assert.equal(await db.dailyLog.count({where:{person:{userId:user.id},type:'NUMBERS_PULLED'}}),1);
  }finally{await fixture.close();}
});

test('intro decisions resume; phone confirmation and explicit call planning are safe to retry', async () => {
  const fixture = await testDatabase(); const db = fixture.client;
  try {
    const user = await db.user.create({data:{name:'Call Test',person:{create:{name:'Call Test'}}}});
    await ensureStart(db,user.id);
    await answerIntro(db,user.id,'track','VERKAUF');
    await advanceIntro(db,user.id,'chat');
    await assert.rejects(chooseStorno(db,user.id,1,'L'));
    for (let i=0;i<5;i++) await chooseStorno(db,user.id,i,'L');
    assert.equal((await chooseStorno(db,user.id,4,'L')).stornoChoices.length,5);
    assert.equal((await advanceIntro(db,user.id,'storno')).introAct,'rechnung');
    await finishIntro(db,user.id,false,'VERKAUF');
    const round=await beginCollection(db,user.id,'VERKAUF');
    const a=await saveName(db,user.id,{name:'Anna',kind:'VERKAUF'});
    const b=await saveName(db,user.id,{name:'Ben',kind:'VERKAUF'});
    await finishCollection(db,user.id,round.id);
    assert.equal((await prepareCalls(db,user.id,'VERKAUF')).candidates.length,0);
    await saveStartPhone(db,user.id,'VERKAUF',a.id,'0301234567');
    await saveStartPhone(db,user.id,'VERKAUF',a.id,'0301234567');
    await saveStartPhone(db,user.id,'VERKAUF',b.id,null);
    assert.equal((await ensureStart(db,user.id)).phoneSkipped.length,1);
    await finishPhones(db,user.id,'VERKAUF');
    assert.equal((await ensureStart(db,user.id)).phase,'CALLS');
    const plan=await prepareCalls(db,user.id,'VERKAUF');
    assert.deepEqual(plan.candidates.map(c=>c.id),[a.id]);
    const at='2030-09-10T16:00';
    await planCalls(db,user.id,'VERKAUF',[a.id],at);
    const first=await db.contact.findUnique({where:{id:a.id}});
    await planCalls(db,user.id,'VERKAUF',[a.id],at);
    assert.equal((await db.contact.findUnique({where:{id:a.id}})).nextStepAt.toISOString(),first.nextStepAt.toISOString());
    assert.equal((await db.contact.findUnique({where:{id:b.id}})).nextStepAt,null);
    assert.equal((await ensureStart(db,user.id)).phase,'DONE');
    const other=await db.user.create({data:{name:'Other'}});
    await assert.rejects(saveStartPhone(db,other.id,'VERKAUF',a.id,'040999'));
    const legacy=await db.user.create({data:{name:'Legacy',onboardingDoneAt:new Date()}});
    assert.equal(await ensureStart(db,legacy.id),null);
  } finally { await fixture.close(); }
});

test('saved names survive retries and a continued collection keeps its scene and selected list', async () => {
  const fixture = await testDatabase();
  const db = fixture.client;
  try {
    const user = await db.user.create({ data: { name: 'Start Test', person: { create: { name: 'Start Test' } } } });
    await ensureStart(db, user.id);
    await finishIntro(db, user.id, false, 'VERKAUF');
    const round = await beginCollection(db, user.id, 'VERKAUF');
    const input = { name: 'Lisa', kind: 'VERKAUF', key: 'test-request-1', collectionId: round.id, scene: 'familie' };
    const first = await saveName(db, user.id, input);
    assert.deepEqual(await saveName(db, user.id, input), first);
    const duplicate = await saveName(db, user.id, { ...input, key: 'test-request-2' });
    assert.equal(duplicate.status, 'already');
    assert.equal((await collectionView(db, user.id, round.id)).names, 1);
    await moveScene(db, user.id, round.id, 0, 'freunde');
    const resumed = await beginCollection(db, user.id, 'VERKAUF');
    assert.equal(resumed.id, round.id);
    assert.equal(resumed.scene, 'freunde');
    assert.deepEqual(await finishCollection(db, user.id, round.id), { names: 1, callable: 0 });
    assert.equal((await ensureStart(db, user.id)).phase, 'PHONES');
    await assert.rejects(saveName(db, user.id, { ...input, key: 'test-request-3' }), /geändert/);
  } finally { await fixture.close(); }
});
