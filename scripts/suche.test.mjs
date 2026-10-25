import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suchtext, passenAlle, suchwoerter, erkenneSuchabsicht, telefonZiffern, gueltigeLetzte } from '../lib/suche/modell.ts';
import { sucheImWegweiser } from '../lib/wegweiser.ts';

test('Namen, Wortreihenfolge, Umlaute, Akzente und begrenzte Tippfehler', () => {
  for (const text of ['Müller', 'Mueller', 'Muller']) assert.equal(suchtext(text), 'muller');
  assert.equal(suchtext('José Groß'), 'jose gross');
  assert.equal(passenAlle(suchwoerter('Weber Anna'), 'Anna Weber'), true);
  for (const text of ['Weebr', 'Weberr', 'Weer', 'Weber']) assert.equal(passenAlle(suchwoerter(text), 'Anna Weber'), true, text);
  assert.equal(passenAlle(['ann'], 'Anrufen'), false, 'Kurze Wörter bleiben präzise');
  assert.equal(passenAlle(['1235'], '1234'), false, 'Keine unscharfen Nummern');
  assert.equal(passenAlle(['anna', 'fremd'], 'Anna Weber'), false, 'Alle Wörter müssen passen');
  assert.equal(suchtext('张伟'), '张伟');
});

test('Telefonformatierung und deutscher Ländercode', () => {
  for (const phone of ['0170 / 123-4567', '+49 170 1234567', '+49 (0) 170 1234567', '0049 170 1234567']) assert.equal(telefonZiffern(phone), '01701234567');
  assert.equal(telefonZiffern('+43 1234567'), '431234567');
});

test('Arbeitsanfragen erzeugen sichtbare Filter und bewahren Personennamen', () => {
  const morgen = erkenneSuchabsicht('Termine morgen', 'alle', '2026-10-24');
  assert.deepEqual([morgen.typ, morgen.von, morgen.bis, morgen.woerter], ['termine', '2026-10-25', '2026-10-26', []]);
  const anrufe = erkenneSuchabsicht('überfällige Rückrufe');
  assert.equal(anrufe.ueberfaellig, true); assert.equal(anrufe.rueckrufe, true); assert.equal(anrufe.typ, 'kontakte');
  assert.equal(erkenneSuchabsicht('Kontakte ohne Telefonnummer').ohneNummer, true);
  assert.equal(erkenneSuchabsicht('Anna Morgen').von, undefined);
  assert.equal(erkenneSuchabsicht('Morgenstern').von, undefined);
  assert.deepEqual(erkenneSuchabsicht('Absprache mit Max').woerter, ['max']);
});

test('25 Suchaufgaben finden das erwartete Funktionsziel unter den ersten drei Treffern', () => {
  const faelle = [
    ['Produktion nachtragen', 'einheiten-eintragen'], ['Einheietn', 'einheiten-eintragen'], ['BWS', 'einheiten-eintragen'],
    ['Namen sammeln', 'namen-sammeln'], ['Liste füllen', 'namen-sammeln'], ['Anrufen', 'namen-durchlauf'],
    ['Gesprächsleitfaden', 'namen-durchlauf'], ['Einwand', 'namen-durchlauf'], ['Nummer fehlt', 'namen-nummern'],
    ['Neuer Kontakt', 'kontakt-neu'], ['Person anlegen', 'kontakt-neu'], ['Was steht an', 'heute'],
    ['Termin eintragen', 'termin-neu'], ['Urlaub', 'termin-neu'], ['Kalender', 'kalender'],
    ['Apple Kalender', 'kalender-abo'], ['Fremdkalender anbinden', 'kalender-quellen'], ['Pipeline', 'trichter'],
    ['Organigramm', 'mannschaft'], ['Neuer Partner', 'einladen'], ['Wo ändere ich mein Wochenziel?', 'ziele'],
    ['Ziel festlegen', 'ziel-neu'], ['Absprachen', 'absprachen'], ['Team auswerten', 'team-auswertung'], ['Benachrichtigungen', 'meldungen'],
  ];
  for (const [frage, id] of faelle) assert.ok(sucheImWegweiser(frage, false).slice(0, 3).some(e => e.id === id), `${frage} → ${id}; tatsächlich: ${sucheImWegweiser(frage, false).slice(0, 3).map(e => e.id)}`);
  assert.equal(sucheImWegweiser('Werkstatt', false).some(e => e.id === 'werkstatt'), false);
  assert.equal(sucheImWegweiser('Werkstatt', true)[0]?.id, 'werkstatt');
});

test('Verlauf enthält nur begrenzte typisierte IDs', () => {
  assert.deepEqual(gueltigeLetzte(['kontakte:abc', 'kontakte:abc', 'https://fremd', 'funktionen:profil', { name: 'Anna' }]), ['kontakte:abc', 'funktionen:profil']);
});
