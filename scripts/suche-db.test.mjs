import assert from 'node:assert/strict';
import { testDatabase } from './test-db.mjs';
import { berlinToday, shiftDay, berlinLocalToUtc } from '../lib/dates.ts';
import { suchtext } from '../lib/suche/modell.ts';
import { Prisma } from '../lib/generated/prisma/client.ts';
import { normalerText, telefonText } from '../lib/suche/sql.ts';

const fixture = await testDatabase();
globalThis.prisma = fixture.client;
const { suche, suchfunktionen } = await import('../lib/suche/service.ts');
const db = fixture.client;
const ich = { id: 'ich', role: 'MEMBER' };
const root = { id: 'root', role: 'ADMIN' };
const today = berlinToday();
const tomorrow = shiftDay(today, 1);
const now = berlinLocalToUtc(`${today}T12:00`);
const sucheNach = (q, typ = 'alle', extra = {}) => suche(ich, { q, typ, ...extra });
try {
  for (const [id, name, path, leaderId] of [['root', 'Admin', '/root/', null], ['ich', 'Anna Nutzerin', '/root/ich/', 'root'], ['max', 'Max Partner', '/root/ich/max/', 'ich'], ['fremd', 'Fremder Partner', '/fremd/', null]]) {
    await db.user.create({ data: { id, name, path, leaderId, role: id === 'root' ? 'ADMIN' : 'MEMBER', passwordHash: 'synthetic-test' } });
  }
  for (const text of ['Müller', 'Mueller', 'José Groß', 'Anna-Weber', '張偉', 'Éléonore']) {
    const [row] = await db.$queryRaw(Prisma.sql`SELECT ${normalerText(Prisma.sql`${text}::text`)} AS text`);
    assert.equal(row.text, suchtext(text), `SQL/JS-Normalisierung: ${text}`);
  }
  for (const phone of ['0170 / 123-4567', '+49 170 1234567', '+49 (0) 170 1234567', '0049 170 1234567']) {
    const [row] = await db.$queryRaw(Prisma.sql`SELECT ${telefonText(Prisma.sql`${phone}::text`)} AS text`);
    assert.equal(row.text, '01701234567');
  }
  const anna = await db.contact.create({ data: { name: 'Anna Müller', ownerId: ich.id, phone: '+49 (0) 170 1234567', email: 'anna.mueller@example.test', job: 'Elektrikerin', source: 'Sportverein', note: 'Arbeitet am Solardach und möchte im Oktober sprechen.', nextStepType: 'ANRUF', nextStepAt: berlinLocalToUtc(`${shiftDay(today, -1)}T12:00`) } });
  const ohne = await db.contact.create({ data: { name: 'Bea Ohne', ownerId: ich.id, phone: '   ' } });
  const hidden = await db.contact.create({ data: { name: 'Anna Geheim', ownerId: 'max', note: 'VERTRAULICHE-KUNDENNOTIZ' } });
  await db.contact.create({ data: { name: 'Anna Fremd', ownerId: 'fremd', phone: '01701234567' } });
  for (const q of ['Müller Anna', 'Mueller', 'Muler', 'anna.mueller@example.test', 'Elektriker', 'Solardach', 'Sportverein', '0170 / 1234567', '+49 1701234567', '4567']) {
    const result = await sucheNach(q, 'kontakte');
    assert.equal(result.treffer[0]?.id, `kontakte:${anna.id}`, `Kontakt über ${q}: ${JSON.stringify(result)}`);
    assert.equal(result.treffer.some(t => t.id === `kontakte:${hidden.id}`), false);
    assert.equal(JSON.stringify(result).includes('VERTRAULICHE'), false);
  }
  assert.equal((await sucheNach('Solardach')).treffer[0].hinweis.startsWith('Notiz:'), true);
  await db.activity.createMany({ data: [
    { contactId: anna.id, type: 'CALL', text: 'Über die Kletterhalle gesprochen.' },
    { contactId: anna.id, type: 'CALL', text: 'Kletterhalle als nächsten Treffpunkt vereinbart.' },
    { contactId: hidden.id, type: 'CALL', text: 'Private Kletterhalle-Details' },
  ] });
  const verlauf = await sucheNach('Kletterhalle', 'kontakte');
  assert.equal(verlauf.treffer.length, 1, 'Kontakt trotz mehrerer passender Verlaufseinträge nur einmal');
  assert.equal(verlauf.treffer[0].hinweis.startsWith('Verlauf:'), true);
  assert.equal((await sucheNach('01701234568', 'kontakte')).treffer.length, 0);
  assert.equal((await suche(root, { q: 'VERTRAULICHE', typ: 'kontakte' })).treffer.length, 0, 'Admin erbt keine fremden Kundennotizen');
  assert.equal((await sucheNach('Kontakte ohne Telefonnummer')).treffer.some(t => t.id === `kontakte:${ohne.id}`), true);
  assert.equal((await sucheNach('überfällige Rückrufe')).treffer[0].id, `kontakte:${anna.id}`);
  assert.equal((await sucheNach('Max', 'team')).treffer[0]?.id, 'team:max');
  assert.equal((await sucheNach('Fremder', 'team')).treffer.length, 0);
  assert.equal((await suche(root, { q: 'Fremder', typ: 'team' })).treffer[0]?.id, 'team:fremd');

  const termin = await db.termin.create({ data: { ownerId: ich.id, titel: 'Schulung Zukunft', von: berlinLocalToUtc(`${tomorrow}T09:00`), bis: berlinLocalToUtc(`${tomorrow}T10:00`), notiz: 'Gesprächsführung' } });
  const rand = await db.termin.create({ data: { ownerId: ich.id, titel: 'Endet vor morgen', von: berlinLocalToUtc(`${today}T23:00`), bis: berlinLocalToUtc(`${tomorrow}T00:00`) } });
  await db.termin.create({ data: { ownerId: 'max', titel: 'Verdeckte Schulung', von: now, bis: new Date(now.getTime() + 3600000) } });
  const quelle = await db.kalenderquelle.create({ data: { ownerId: ich.id, name: 'Familie', art: 'TIMETREE' } });
  const fremdtermin = await db.fremdtermin.create({ data: { quelleId: quelle.id, fremdUid: 'synthetic', titel: 'Schwimmen', von: berlinLocalToUtc(`${tomorrow}T14:00`), bis: berlinLocalToUtc(`${tomorrow}T15:00`) } });
  const absprache = await db.partnerVereinbarung.create({ data: { titel: 'Startgespräch vorbereiten', initiatorId: ich.id, empfaengerId: 'max', verantwortlicherId: 'max', vorgeschlagenVonId: ich.id, status: 'BESTAETIGT', art: 'TERMIN', faelligAm: berlinLocalToUtc(`${tomorrow}T11:00`), endetAm: berlinLocalToUtc(`${tomorrow}T12:00`) } });
  const kalender = await sucheNach('Termine morgen');
  assert.equal(kalender.treffer.some(t => t.id === `termine:eigen:${rand.id}`), false, 'Ende genau am Tagesanfang zählt nicht in den Folgetag');
  for (const id of [`termine:eigen:${termin.id}`, `termine:fremd:${fremdtermin.id}`, `termine:absprache:${absprache.id}`]) assert.ok(kalender.treffer.some(t => t.id === id), `Terminquellen: ${id}`);
  assert.ok((await sucheNach('Gesprächsführung', 'termine')).treffer.some(t => t.id === `termine:eigen:${termin.id}`));
  assert.equal((await sucheNach('Verdeckte', 'termine')).treffer.length, 0);
  assert.equal((await sucheNach('Absprache mit Max')).treffer[0]?.id, `absprachen:${absprache.id}`);
  assert.equal((await suche(root, { q: 'Startgespräch', typ: 'absprachen' })).treffer.length, 0);
  await db.user.update({ where: { id: 'max' }, data: { path: '/fremd/max/', leaderId: 'fremd' } });
  assert.equal((await sucheNach('Startgespräch', 'absprachen')).treffer.length, 0, 'Teamwechsel entzieht Zugriff vor Trefferbildung');
  assert.equal((await sucheNach('', 'alle', { zuletzt: [`kontakte:${hidden.id}`, `absprachen:${absprache.id}`, `kontakte:${anna.id}`] })).treffer.length, 1, 'Zuletzt geöffnet prüft Rechte erneut');
  await db.kalenderquelle.update({ where: { id: quelle.id }, data: { aktiv: false } });
  assert.equal((await sucheNach('Schwimmen')).treffer.length, 0);

  const ziel = await db.ziel.create({ data: { inhaberId: ich.id, erstelltVonId: ich.id, titel: 'Meine Anrufwoche', wunsch: 'Urlaub am Meer', kennzahl: 'CALL', zeitraum: 'WOCHE', start: now, ende: new Date(now.getTime() + 7 * 86400000), zielwert: 20 } });
  assert.equal((await sucheNach('Meer', 'ziele')).treffer[0]?.id, `ziele:${ziel.id}`);
  assert.equal((await suche(root, { q: 'Meer', typ: 'ziele' })).treffer.length, 0);
  await db.contact.createMany({ data: Array.from({ length: 65 }, (_, i) => ({ name: `Anna Beispiel ${String(i).padStart(3, '0')}`, ownerId: ich.id })) });
  const exact = await db.contact.create({ data: { name: 'Anna', ownerId: ich.id } });
  const first = await sucheNach('Anna', 'kontakte');
  const second = await sucheNach('Anna', 'kontakte', { seite: 1 });
  assert.equal(first.treffer[0].id, `kontakte:${exact.id}`, 'Exakter Treffer vor Begrenzung, nicht alphabetische Vorauswahl');
  assert.equal(first.treffer.length, 20); assert.equal(first.mehr, true);
  assert.equal(second.treffer.length, 20); assert.ok(second.treffer.every(t => !first.treffer.some(v => v.id === t.id)));
  await db.feature.upsert({ where: { key: 'einheiten' }, update: { state: 'AUS' }, create: { key: 'einheiten', titel: 'Einheiten', state: 'AUS' } });
  assert.equal((await suchfunktionen(ich)).some(f => f.id === 'einheiten-eintragen'), false);
  await db.feature.upsert({ where: { key: 'zinsrechner' }, update: { state: 'AUS' }, create: { key: 'zinsrechner', titel: 'Zinsrechner', state: 'AUS' } });
  assert.equal((await suchfunktionen(ich)).some(f => f.id === 'zinsrechner'), false, 'Zusammengeführte Suche respektiert den aktuellen Rechner-Schalter');
  assert.equal((await sucheNach('Werkstatt')).treffer.some(t => t.id === 'funktionen:werkstatt'), false);
  for (const query of ['%', '***', "' OR 1=1 --", '((((a+)+)+)']) assert.equal((await sucheNach(query, 'kontakte')).treffer.length, 0);
  console.log('Such-Datenbanktests bestanden: Normalisierung, Ranking, 6 Bereiche, 4 Terminquellen, Nummern, Pagination, Freigaben und Teamwechsel.');
} finally { delete globalThis.prisma; await fixture.close(); }
