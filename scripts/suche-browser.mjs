// Ausschließlich synthetische Daten in einer wegwerfbaren PostgreSQL-Instanz.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { testDatabase } from './test-db.mjs';
import { createSession, authCookieName } from '../lib/session.ts';
import { berlinToday, shiftDay, berlinLocalToUtc } from '../lib/dates.ts';

const fixture = await testDatabase(0, 40);
const db = fixture.client;
const port = Number(process.env.CRM_TEST_PORT || 3137);
const origin = `http://127.0.0.1:${port}`;
const output = new URL('../test-results/suche/', import.meta.url);
await mkdir(output, { recursive: true });
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
const today = berlinToday();
const now = new Date();
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.CRM_TEST_PRODUCTION === '1' ? 'start' : 'dev', '-p', String(port), '--hostname', '127.0.0.1'], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, DATABASE_URL: fixture.url, DIRECT_URL: fixture.url, DATABASE_POOL_MAX: '1', NEXT_TELEMETRY_DISABLED: '1' },
});
let serverLog = '';
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
let browser;
try {
  for (const [id, name, path, leaderId] of [['ich', 'Lena Schneider', '/ich/', null], ['max', 'Max Partner', '/ich/max/', 'ich'], ['fremd', 'Fremder Nutzer', '/fremd/', null]]) {
    await db.user.create({ data: { id, name, path, leaderId, passwordHash: 'synthetic-test', onboardingDoneAt: now, installedAt: now, startTrack: 'VERKAUF', person: { create: { name } } } });
  }
  const anna = await db.contact.create({ data: { ownerId: 'ich', name: 'Anna Müller', phone: '+49 170 1234567', job: 'Elektrikerin', email: 'anna@example.test', note: 'Plant eine Solaranlage auf dem Familienhaus.', nextStepType: 'ANRUF', nextStepAt: berlinLocalToUtc(`${shiftDay(today, -1)}T11:00`) } });
  const geheim = await db.contact.create({ data: { ownerId: 'fremd', name: 'Geheimer Kontakt', note: 'VERTRAULICH' } });
  await db.contact.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ ownerId: 'ich', name: `Person ${String(i).padStart(2, '0')}` })) });
  const termin = await db.termin.create({ data: { ownerId: 'ich', titel: 'Gesprächsführung üben', von: berlinLocalToUtc(`${shiftDay(today, 1)}T10:00`), bis: berlinLocalToUtc(`${shiftDay(today, 1)}T11:00`) } });
  const absprache = await db.partnerVereinbarung.create({ data: { titel: 'Den ersten Termin vorbereiten', initiatorId: 'ich', empfaengerId: 'max', verantwortlicherId: 'max', vorgeschlagenVonId: 'ich', status: 'BESTAETIGT', art: 'AUFGABE', faelligAm: now } });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10000) })).ok) break; } catch {}
    if (i === 119) throw new Error(`Server startet nicht: ${serverLog.slice(-2500)}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addCookies([{ name: authCookieName, value: await createSession('ich'), url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const capture = async name => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)), fullPage: true });
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Kein horizontaler Seitenüberlauf');
  const input = () => page.getByRole('searchbox', { name: 'Kontakte, Funktionen und Inhalte suchen' });
  const results = () => page.locator('#suchtreffer');
  const settled = () => page.getByRole('region', { name: 'Suchergebnisse' }).locator('[role=status]').filter({ hasText: /Treffer/ }).waitFor();

  await page.goto(`${origin}/suche`);
  await input().waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'crm-suche');
  await page.getByRole('heading', { name: 'Häufig gebraucht' }).waitFor();
  await noOverflow(); await capture('01-suchstart-mobil');
  await input().fill('Muller'); await settled();
  await results().getByRole('link', { name: /Anna Müller/ }).waitFor();
  assert.equal(await input().inputValue(), 'Muller');
  assert.ok(page.url().includes('q=Muller'));
  await noOverflow(); await capture('02-kontakt-mobil');
  await input().fill('Solaranlage'); await settled();
  await results().getByText(/Notiz:.*Solaranlage/).waitFor();
  await capture('03-notiz-mobil');
  await results().getByRole('link', { name: /Anna Müller/ }).click();
  await page.waitForURL(`**/contacts/${anna.id}`);
  await page.goBack(); await input().waitFor();
  assert.equal(await input().inputValue(), 'Solaranlage', 'Zurück erhält den Suchtext');
  await page.getByRole('button', { name: 'Suche leeren' }).click();
  await page.getByRole('region', { name: 'Zuletzt geöffnet' }).getByRole('link', { name: /Anna Müller/ }).waitFor();
  const storage = await page.evaluate(() => sessionStorage.getItem('crm.suche.zuletzt.ich'));
  assert.ok(storage.includes(anna.id)); assert.equal(storage.includes('Anna'), false, 'Verlauf speichert nur IDs');

  await input().fill('Termine morgen'); await settled();
  await page.getByText('Gefiltert: Termine · Morgen', { exact: true }).waitFor();
  await results().getByRole('link', { name: /Gesprächsführung üben/ }).waitFor();
  const calendarHref = await results().getByRole('link', { name: /Gesprächsführung üben/ }).getAttribute('href');
  assert.ok(calendarHref.includes(`eigen%3A${termin.id}`));
  await results().getByRole('link', { name: /Gesprächsführung üben/ }).click();
  await page.locator(`[id="termin-eigen:${termin.id}"]`).waitFor();
  await page.goto(`${origin}/suche?q=Absprache+mit+Max`); await settled();
  await results().getByRole('link', { name: /Den ersten Termin vorbereiten/ }).click();
  await page.waitForURL(`**/mannschaft/vereinbarungen/${absprache.id}`);
  await page.getByRole('heading', { name: 'Eure Absprache' }).waitFor();

  await page.goto(`${origin}/suche?q=Person&typ=kontakte`); await settled();
  assert.equal(await results().getByRole('link').count(), 20);
  await page.getByRole('button', { name: 'Weitere Treffer anzeigen' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#suchtreffer a').length === 25);
  await page.setViewportSize({ width: 320, height: 568 }); await noOverflow(); await capture('04-kleines-display');
  await page.setViewportSize({ width: 768, height: 1024 }); await noOverflow(); await capture('04-tablet');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await input().fill('Produktion nachtragen'); await page.getByRole('button', { name: 'Alles', exact: true }).click(); await settled();
  await results().getByRole('link', { name: /Einheiten eintragen/ }).waitFor();
  await input().focus(); await page.keyboard.press('ArrowDown');
  assert.ok(await page.evaluate(() => document.activeElement?.closest('#suchtreffer')));
  await page.keyboard.press('Escape'); assert.equal(await input().evaluate(e => e === document.activeElement), true);
  await capture('05-funktionen-desktop');
  await page.locator('a[aria-label="Profil und Einstellungen"]').click();
  await page.getByRole('heading', { name: 'Dein Profil' }).waitFor();
  await page.keyboard.press('Control+k');
  await page.waitForURL('**/suche'); await input().waitFor();

  // Eine langsamere alte Antwort darf die neue Anfrage nicht ersetzen.
  await page.route('**/api/suche?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'langsam') {
      await new Promise(resolve => setTimeout(resolve, 900));
      await route.fulfill({ json: { treffer: [{ id: 'kontakte:stale', typ: 'kontakte', titel: 'VERALTETER TREFFER', kontext: '', href: '/contacts/stale', punkte: 9999 }], mehr: false, filter: [] } });
    } else await route.continue();
  });
  await input().fill('langsam'); await page.waitForRequest(r => r.url().includes('q=langsam'));
  await input().fill('Anna'); await settled(); await results().getByRole('link', { name: /Anna Müller/ }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(await page.getByText('VERALTETER TREFFER').count(), 0);
  await page.unroute('**/api/suche?**');
  await page.route('**/api/suche?**', route => route.fulfill({ status: 503, json: { fehler: 'Testfehler' } }));
  await input().fill('Kalender'); await page.getByRole('alert').filter({ hasText: 'Die Inhalte konnten nicht geladen werden.' }).waitFor();
  await results().getByRole('link', { name: /Kalender ansehen/ }).waitFor();
  await page.unroute('**/api/suche?**');
  await page.getByRole('button', { name: 'Erneut versuchen' }).click(); await settled();

  const privateResult = await context.request.get(`${origin}/api/suche?q=VERTRAULICH`);
  assert.ok(privateResult.headers()['cache-control'].includes('no-store'));
  assert.equal((await privateResult.json()).treffer.length, 0);
  const staleRecent = await context.request.get(`${origin}/api/suche?zuletzt=${encodeURIComponent(JSON.stringify([`kontakte:${geheim.id}`]))}`);
  assert.equal((await staleRecent.json()).treffer.length, 0);
  await context.clearCookies();
  const loggedOut = await context.request.get(`${origin}/api/suche?q=Anna`, { maxRedirects: 0 });
  assert.ok([302, 303, 307, 308].includes(loggedOut.status()), 'Ohne Anmeldung keine Suchdaten');
  assert.deepEqual(pageErrors, []);
  console.log('Browserabnahme bestanden: mobile Größen, Eingabe, Rückweg, Verlauf, Termin-/Absprachedetails, Pagination, Tastatur, Fehler, Antwortreihenfolge und Anmeldung.');
} finally {
  await writeFile(new URL('server.log', output), serverLog);
  await browser?.close(); server.kill(); await new Promise(resolve => setTimeout(resolve, 500)); await fixture.close();
}
