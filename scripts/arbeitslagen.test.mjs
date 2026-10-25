import test from 'node:test';
import assert from 'node:assert/strict';
import { arbeitslageFuer, istArbeitsfokus } from '../lib/arbeitslage.ts';
import { HAUPTNAVIGATION, navAktiv } from '../lib/navigation.ts';

test('der erste aktivierte Partner ergänzt den Aufbau, ohne manuelle Führung zu überschreiben', () => {
  assert.equal(arbeitslageFuer('AUTO', 0), 'START');
  assert.equal(arbeitslageFuer('AUTO', 1), 'AUFBAU');
  assert.equal(arbeitslageFuer('FUEHRUNG', 1), 'FUEHRUNG');
  assert.equal(arbeitslageFuer('EIGEN', 5), 'START');
  assert.equal(istArbeitsfokus('ADMIN'), false);
});

test('Unterseiten behalten genau einen vertrauten Navigationspunkt', () => {
  for (const [url, label] of [['/contacts/anna', 'Kontakte'], ['/einheiten', 'Fortschritt'], ['/mannschaft/auswertung', 'Team'], ['/leaderboard', 'Fortschritt'], ['/einladen', 'Team']]) {
    assert.deepEqual(HAUPTNAVIGATION.filter(link => navAktiv(link, url)).map(link => link.label), [label]);
  }
  assert.equal(HAUPTNAVIGATION.some(link => navAktiv(link, '/team')), false);
});
