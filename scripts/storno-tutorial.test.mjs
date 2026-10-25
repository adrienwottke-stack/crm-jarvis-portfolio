import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replayTutorial } from '../public/storno-tutorial.js';

const html = readFileSync(new URL('../public/storno.html', import.meta.url), 'utf8');
const match = html.match(/var CARDS = (\[[\s\S]*?\n  \]);/);
const cards = runInNewContext(`(${match[1]})`);

test('a resumed tutorial restores the selected cards and effects without changing the original deck', () => {
  const run = replayTutorial(cards, ['L', 'R', 'L', 'R', 'R']);
  assert.deepEqual(run.bars, { p: 65, z: 45, f: 35, s: 10 });
  assert.equal(run.done, true);
  assert.equal(replayTutorial(cards, ['L', 'R', 'L']).index, 3);
  assert.equal(replayTutorial(cards, []).deck[0].id, 'navi');
});

test('all 32 decision sequences finish after exactly five cards', () => {
  for (let mask = 0; mask < 32; mask++) {
    const choices = Array.from({ length: 5 }, (_, i) => mask & (1 << i) ? 'L' : 'R');
    assert.equal(replayTutorial(cards, choices.slice(0, 4)).done, false);
    assert.equal(replayTutorial(cards, choices).done, true);
  }
  assert.throws(() => replayTutorial(cards, ['invalid']));
  assert.throws(() => replayTutorial(cards, ['L', 'L', 'L', 'L', 'L', 'L']));
});
