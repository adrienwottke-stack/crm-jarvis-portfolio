// Self-contained browser regression: fresh in-memory DB, local Next server, fake accounts.
// Run `npx playwright install chromium` once, then `npm run test:start:browser`.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { testDatabase } from './start-test-db.mjs';
import { createSession, authCookieName } from '../lib/session.ts';
import { ensureStart } from '../lib/start/service.ts';

const require=createRequire(import.meta.url);
const { chromium }=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture=await testDatabase(0,50);
const db=fixture.client;
const port=Number(process.env.START_TEST_PORT || 3105);
const origin=`http://localhost:${port}`;
const production=process.env.CRM_TEST_PRODUCTION === '1';
const output=new URL('../test-results/start/',import.meta.url);
await mkdir(output,{recursive:true});
process.env.SESSION_SECRET=randomBytes(32).toString('hex');
const env={...process.env,DATABASE_URL:fixture.url,DATABASE_POOL_MAX:'1',NEXT_TELEMETRY_DISABLED:'1'};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next',production ? 'start' : 'dev','-p',String(port),'--hostname','127.0.0.1'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',c=>{serverLog+=c;appendFileSync(new URL('server.log',output),c);});server.stderr.on('data',c=>{serverLog+=c;appendFileSync(new URL('server.log',output),c);});
let browser;
let failed=false;
try {
  for(let i=0;i<90;i++) {
    try {if((await fetch(`${origin}/login`,{signal:AbortSignal.timeout(30000)})).ok) break;} catch {}
    if(i===89) throw new Error('Next server did not start: '+serverLog.slice(-3000));
    await new Promise(r=>setTimeout(r,500));
  }
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});
  const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  const user=await db.user.create({data:{name:'Browser Test',email:'browser@example.test',startedAt:new Date(),person:{create:{name:'Browser Test'}}}});
  await context.addCookies([{name:authCookieName,value:await createSession(user.id),url:origin}]);
  await page.goto(`${origin}/start`);
  await page.getByRole('button',{name:'Kunden gewinnen',exact:true}).click();
  await page.getByRole('button',{name:'Ehrlich: keine',exact:true}).click();
  await page.getByRole('button',{name:'Kurze Runde spielen',exact:true}).click();
  const game=page.frameLocator('iframe[title="Storno – fünf Entscheidungen"]');
  await game.locator('#btnL').waitFor({state:'visible'});
  await page.screenshot({path:new URL('storno-mobile.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await page.setViewportSize({width:320,height:568});
  await page.screenshot({path:new URL('storno-small.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  const bounds=await game.locator('#btnR').evaluate(el=>({bottom:el.getBoundingClientRect().bottom,height:innerHeight}));
  assert.ok(bounds.bottom<=bounds.height,'Small-screen choice must stay inside the game frame');
  const readable=await game.locator('.card').evaluate(el=>el.querySelector('.body .note').getBoundingClientRect().bottom <= el.querySelector('.perfo').getBoundingClientRect().top);
  assert.ok(readable,'Small-screen card text must not overlap the footer');
  await page.setViewportSize({width:390,height:844});
  for(let i=0;i<5;i++) {
    await game.locator('#btnL').click();
    await page.waitForFunction(count=>document.body.innerText.includes(count===5 ? 'Runde geschafft.' : `Karte ${count+1} von 5`),i+1);
    if(i<4) await game.locator('.card').waitFor({state:'visible'});
  }
  assert.equal((await db.startProgress.findUnique({where:{userId:user.id}})).stornoChoices.length,5);
  await page.getByRole('button',{name:'Weiter mit deinem Start'}).click();
  // The merged career scene persists only confirmed input and remains retryable.
  await db.startProgress.update({where:{userId:user.id},data:{introAct:'karrierestufe'}});
  await page.reload();
  await page.getByRole('button',{name:'3',exact:true}).click();
  await page.getByLabel('Einheiten vor der App').fill('120,50');
  await page.route('**/willkommen',route=>route.request().method()==='POST' ? route.abort('failed') : route.continue());
  await page.getByRole('button',{name:'Übernehmen',exact:true}).click();
  await page.getByRole('button',{name:'Erneut versuchen',exact:true}).waitFor();
  assert.equal((await db.user.findUnique({where:{id:user.id}})).karrierestufe,null);
  await page.unroute('**/willkommen');
  await page.getByRole('button',{name:'Erneut versuchen',exact:true}).click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Eine Sache noch: deine Stufe.'));
  const career=await db.user.findUniqueOrThrow({where:{id:user.id}});
  assert.equal(career.karrierestufe,3);assert.equal(career.einheitenStart,12050);
  assert.equal((await db.startProgress.findUnique({where:{userId:user.id}})).introAct,'rangliste');
  // Resume the final intro act to exercise arrival without replaying unrelated quizzes.
  await db.startProgress.update({where:{userId:user.id},data:{introAct:'ankunft'}});
  await page.reload();
  await page.getByRole('button',{name:'Ohne Ziel starten'}).click();
  assert.equal(await db.contact.count({where:{ownerId:user.id,nextStepType:{not:null}}}),0);
  await page.getByRole('button',{name:'Jetzt Namen sammeln',exact:true}).click();
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Lisa Test');
  await page.getByRole('button',{name:'Hinzufügen',exact:true}).click();
  await page.getByRole('button',{name:'Nächster Bereich',exact:true}).click();
  await page.getByRole('heading',{name:'Enge Freunde',exact:true}).waitFor();
  await page.reload();
  await page.getByRole('heading',{name:'Enge Freunde',exact:true}).waitFor();
  await page.getByRole('button',{name:'Später fortsetzen',exact:true}).click();
  await page.waitForURL('**/heute');
  await page.goto(`${origin}/start`);await page.waitForURL('**/heute');
  await page.getByRole('region',{name:'Namen sammeln',exact:true}).waitFor({state:'visible'});
  assert.equal(await page.getByRole('region',{name:'Dein nächster Startschritt'}).count(),0);
  await page.getByRole('region',{name:'Namen sammeln',exact:true}).getByRole('button',{name:'Jetzt Namen sammeln',exact:true}).click();
  await page.getByRole('heading',{name:'Enge Freunde',exact:true}).waitFor();
  await page.screenshot({path:new URL('collection-mobile.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await page.getByRole('button',{name:'Für heute fertig',exact:true}).click();
  await page.getByRole('link',{name:'Nummern ergänzen',exact:true}).click();
  await page.getByRole('textbox',{name:'Telefonnummer',exact:true}).fill('0301234567');
  await page.getByRole('button',{name:'Nummer speichern',exact:true}).click();
  await page.getByRole('button',{name:'Erste Anrufe vorbereiten',exact:true}).click();
  await page.getByRole('button',{name:'Für später einplanen',exact:true}).click();
  await page.getByLabel('Beginn (Berliner Zeit)').fill('2030-09-10T16:00');
  await page.getByRole('button',{name:'Diese Anrufe verbindlich einplanen',exact:true}).click();
  await page.waitForURL('**/heute');
  assert.equal(await db.contact.count({where:{ownerId:user.id,nextStepType:'ANRUF'}}),1);
  assert.equal((await db.startProgress.findUnique({where:{userId:user.id}})).phase,'DONE');
  await page.goto(`${origin}/start`);await page.waitForURL('**/heute');
  assert.equal(await page.getByRole('region',{name:'Dein nächster Startschritt'}).count(),0);
  // Completed users replay as a demo. Early skip never changes their checkpoint.
  await page.goto(`${origin}/willkommen`);
  await page.getByRole('button',{name:'Vorschau beenden'}).click();await page.waitForURL('**/heute');
  assert.equal((await db.startProgress.findUnique({where:{userId:user.id}})).phase,'DONE');
  assert.equal(await db.contact.count({where:{ownerId:user.id}}),1);
  // A career scene in a completed account is a preview, even when its old checkpoint survives.
  const preview=await db.user.create({data:{name:'Career Preview',onboardingDoneAt:new Date(),karrierestufe:2,einheitenStart:4500,startTrack:'VERKAUF',startProgress:{create:{phase:'INTRO',introAct:'karrierestufe',kind:'VERKAUF'}}}});
  await context.clearCookies();await context.addCookies([{name:authCookieName,value:await createSession(preview.id),url:origin}]);
  await page.goto(`${origin}/willkommen`);
  await page.setViewportSize({width:320,height:568});
  await page.getByRole('button',{name:'6',exact:true}).click();
  await page.getByLabel('Einheiten vor der App').fill('999,00');
  await page.getByRole('button',{name:'Weiter',exact:true}).click();
  await page.waitForFunction(()=>!document.body.innerText.includes('Eine Sache noch: deine Stufe.'));
  const unchanged=await db.user.findUniqueOrThrow({where:{id:preview.id}});
  assert.equal(unchanged.karrierestufe,2);assert.equal(unchanged.einheitenStart,4500);
  assert.equal((await db.startProgress.findUnique({where:{userId:preview.id}})).introAct,'karrierestufe');
  await page.setViewportSize({width:390,height:844});
  // The full game remains independently playable.
  await page.goto(`${origin}/storno.html`);
  await page.locator('#startBtn').click();await page.locator('#btnL').waitFor({state:'visible'});
  assert.equal(await page.locator('.heimweg').isVisible(),true);
  // A new account skipping before track choice must choose a list, not inherit Recruiting.
  const early=await db.user.create({data:{name:'Early Test',person:{create:{name:'Early Test'}}}});
  await ensureStart(db,early.id);
  await context.clearCookies();await context.addCookies([{name:authCookieName,value:await createSession(early.id),url:origin}]);
  await page.goto(`${origin}/willkommen`);await page.getByRole('button',{name:'Überspringen',exact:true}).click();
  await page.waitForURL('**/namen/sammeln');
  assert.equal((await db.startProgress.findUnique({where:{userId:early.id}})).kind,null);
  // Sprint: failed HTTP write preserves the name and retry key; a reload restores the deadline.
  const sprinter=await db.user.create({data:{name:'Sprint Browser',person:{create:{name:'Sprint Browser'}}}});
  await ensureStart(db,sprinter.id);
  await db.startProgress.update({where:{userId:sprinter.id},data:{introAct:'sprint',kind:'VERKAUF'}});
  await context.clearCookies();await context.addCookies([{name:authCookieName,value:await createSession(sprinter.id),url:origin}]);
  await page.goto(`${origin}/willkommen`);await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.getByRole('textbox',{name:'Name',exact:true}).waitFor();
  const deadline=(await db.startProgress.findUnique({where:{userId:sprinter.id}})).sprintEndAt.toISOString();
  await page.route('**/willkommen',route=>route.request().method()==='POST' ? route.abort('failed') : route.continue());
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Offline Lisa');
  await page.getByRole('button',{name:'Name eintragen',exact:true}).click();
  await page.getByRole('button',{name:'Speichern erneut versuchen',exact:true}).waitFor();
  assert.equal(await db.contact.count({where:{ownerId:sprinter.id}}),0);
  await page.unroute('**/willkommen');
  await page.getByRole('button',{name:'Speichern erneut versuchen',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('1 Namen gespeichert'));
  await page.reload();
  assert.equal((await db.startProgress.findUnique({where:{userId:sprinter.id}})).sprintEndAt.toISOString(),deadline);
  await page.getByRole('textbox',{name:'Name',exact:true}).fill('Offline Lisa');
  await page.getByRole('button',{name:'Name eintragen',exact:true}).click();
  await page.getByRole('button',{name:'Mir fällt keiner mehr ein',exact:true}).click();
  await page.getByRole('button',{name:'Weiter',exact:true}).click();
  assert.equal(await db.contact.count({where:{ownerId:sprinter.id}}),1);
  assert.equal(await db.dailyLog.count({where:{person:{userId:sprinter.id},type:'NUMBERS_PULLED'}}),1);
  // Desktop entry and stale tabs use the same checkpoints.
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${origin}/willkommen`);
  await page.screenshot({path:new URL('desktop.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile Storno → career setup/retry → collection → postpone/resume → phone → explicit call plan; career demo; ordinary game; early skip; offline sprint retry and reload; desktop.');
} catch(e) {
  console.error(e);
  if(browser) for(const context of browser.contexts()) for(const page of context.pages()) {
    console.error('Page:',page.url(),(await page.locator('body').innerText().catch(()=>'' )).slice(0,3500));
    await page.screenshot({path:new URL('failure.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true}).catch(()=>{});
  }
  failed=true;
} finally {
  await writeFile(new URL('server.log',output),serverLog);
  await browser?.close();
  server.kill();
  await fixture.close();
}
process.exitCode=failed ? 1 : 0;
