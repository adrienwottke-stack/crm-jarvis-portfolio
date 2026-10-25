import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startRoute, afterCollection, introSuccessor } from '../lib/start/model.ts';

test('a deliberately postponed collection opens Today, while an interrupted one resumes the selected list', () => {
  const state = { phase: 'COLLECTION', paused: false, kind: 'VERKAUF', collectionId: 'round-1' };
  assert.equal(startRoute(state), '/namen/sammeln?liste=VERKAUF&runde=round-1');
  assert.equal(startRoute({ ...state, paused: true }), '/heute');
  assert.equal(startRoute(null), '/heute');
});

test('finishing with eight names leads to phone preparation, not another twenty-name requirement', () => {
  assert.equal(afterCollection({ names: 8, callable: 0 }), 'PHONES');
  assert.equal(afterCollection({ names: 8, callable: 1 }), 'CALLS');
  assert.equal(afterCollection({ names: 0, callable: 0 }), 'DONE');
  assert.equal(introSuccessor('chat'), 'storno');
  assert.equal(introSuccessor('storno'), 'rechnung');
  assert.equal(introSuccessor('einstufung'), 'karrierestufe');
  assert.equal(introSuccessor('karrierestufe'), 'rangliste');
  assert.equal(startRoute({ phase: 'PHONES', paused: false, kind: null, collectionId: null }), '/namen/sammeln');
});
import { startFeatures } from '../lib/start/model.ts';

test('both feature switches default off and can be changed independently',()=>{
  assert.deepEqual(startFeatures(new Map()),{guidance:false,game:false});
  assert.deepEqual(startFeatures(new Map([['startfuehrung','TEST'],['stornoStart','AUS']])),{guidance:true,game:false});
  assert.deepEqual(startFeatures(new Map([['startfuehrung','AUS'],['stornoStart','LAEUFT']])),{guidance:false,game:true});
});
