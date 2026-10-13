import test from 'node:test';
import assert from 'node:assert/strict';
import { noteName, midiFor, allPositions } from '../dist/pitch.js';

test('standard tuning and chromatic names keep octave and enharmonic relationships', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(string => midiFor(string, 0)), [64, 59, 55, 50, 45, 40]);
  assert.equal(midiFor(6, 8), 48);
  assert.equal(midiFor(5, 3), 48);
  assert.equal(midiFor(1, 24), 88);
  assert.deepEqual([0, 1, 11, 12, 13, -1].map(pc => noteName(pc)), ['C', 'C♯', 'B', 'C', 'C♯', 'B']);
  assert.equal(noteName(1, true), 'D♭');
  assert.equal(noteName(10, true), 'B♭');
  assert.equal(noteName(NaN), '—');
  assert.equal(noteName(Infinity), '—');
});

test('MIDI calculation rejects invalid strings and frets instead of returning a misleading pitch', () => {
  for (const string of [0, 7, -1, 1.5, '1', null, undefined, NaN, Infinity]) {
    assert.throws(() => midiFor(string, 1), RangeError);
  }
  for (const fret of [-1, 25, 1.5, '1', null, undefined, NaN, Infinity]) {
    assert.throws(() => midiFor(1, fret), RangeError);
  }
});

test('all 138 positions through 22F retain standard tuning and their stable string/fret order', () => {
  const positions = allPositions({ maxFret: 22 });
  const openMidis = [64, 59, 55, 50, 45, 40];
  assert.equal(positions.length, 138);
  assert.equal(new Set(positions.map(position => position.id)).size, 138);
  for (let string = 1; string <= 6; string++) {
    for (let fret = 0; fret <= 22; fret++) {
      const midi = openMidis[string - 1] + fret;
      assert.deepEqual(positions[(string - 1) * 23 + fret], {
        id: `${string}-${fret}`, string, fret, midi, pc: midi % 12,
      });
      assert.equal(midiFor(string, fret), midi);
      if (fret >= 12) assert.equal(midiFor(string, fret) - midiFor(string, fret - 12), 12);
    }
  }
});

test('position ranges deduplicate and validate strings while retaining natural-note filtering', () => {
  assert.equal(allPositions({ maxFret: 5 }).length, 36);
  const positions = allPositions({ maxFret: 22, strings: [6, 6, 2, 9, 0, '1', 1.5, NaN], naturalsOnly: true });
  assert.deepEqual([...new Set(positions.map(position => position.string))], [6, 2]);
  assert.equal(new Set(positions.map(position => position.id)).size, positions.length);
  assert.ok(positions.every(position => position.fret <= 22 && [0, 2, 4, 5, 7, 9, 11].includes(position.pc)));
  assert.ok(positions.some(position => position.fret === 22));
  assert.deepEqual(allPositions({ strings: [] }), []);
  assert.deepEqual(allPositions({ strings: [0, 7, NaN] }), []);
  for (const strings of [undefined, null, '1', 1, {}]) {
    assert.deepEqual(allPositions({ strings }), allPositions());
  }
});

test('invalid range limits fall back safely and valid limits stay bounded at 22F', () => {
  const standard = allPositions({ maxFret: 12 });
  assert.equal(standard.length, 78);
  assert.deepEqual(allPositions(), standard);
  for (const maxFret of [undefined, NaN, Infinity, -Infinity, '22', null, true]) {
    assert.deepEqual(allPositions({ maxFret }), standard);
  }
  assert.deepEqual(allPositions({ maxFret: 99 }), allPositions({ maxFret: 22 }));
  assert.deepEqual(allPositions({ maxFret: -1 }), allPositions({ maxFret: 0 }));
  assert.deepEqual(allPositions({ maxFret: 5.9 }), allPositions({ maxFret: 5 }));
});
