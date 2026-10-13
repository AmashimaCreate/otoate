import test from 'node:test';
import assert from 'node:assert/strict';
import { allPositions, midiFor } from '../dist/pitch.js';
import { LEVELS, RANGES, DIFFICULTIES, makeExercise, gradeAnswer, matchingPositions } from '../dist/ear-model.js';

const at = (string, fret) => ({ id: `${string}-${fret}`, string, fret, midi: midiFor(string, fret), pc: midiFor(string, fret) % 12 });
const sequence = values => { let index = 0; return () => values[index++ % values.length]; };

test('grading accepts the same absolute pitch on another string and rejects an octave', () => {
  const target = [at(6, 8)]; // C3 also lies at 5th-string fret 3.
  assert.deepEqual(gradeAnswer(target, [at(5, 3)]), { correct: true, complete: true, matches: [true] });
  assert.deepEqual(gradeAnswer(target, [at(4, 10)]), { correct: false, complete: true, matches: [false] });
  assert.equal(gradeAnswer(target, [{ ...at(5, 4), midi: 48 }]).correct, false);
  assert.equal(gradeAnswer(target, [{ ...at(5, 3), midi: 99 }]).correct, true);
  assert.equal(gradeAnswer([48], [48]).correct, true);
});

test('partial, extra, invalid and reordered answers cannot complete a correct phrase', () => {
  const target = [at(1, 0), at(1, 2)];
  assert.deepEqual(gradeAnswer(target, [at(1, 0)]), { correct: false, complete: false, matches: [true, false] });
  assert.deepEqual(gradeAnswer(target, [at(1, 2), at(1, 0)]), { correct: false, complete: true, matches: [false, false] });
  assert.equal(gradeAnswer(target, [...target, target[0]]).complete, false);
  assert.equal(gradeAnswer(target, [target[0], { string: 7, fret: 2, midi: target[1].midi }]).correct, false);
  assert.deepEqual(gradeAnswer([], []), { correct: false, complete: false, matches: [] });
  assert.deepEqual(gradeAnswer(null, null), { correct: false, complete: false, matches: [] });
});

test('every note count and difficulty stays inside its range with non-repeating consecutive pitches', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const range of RANGES) {
      for (const level of LEVELS) {
        for (const value of [0, 0.17, 0.5, 0.86, 0.99999, 1]) {
          const exercise = makeExercise({ level: level.id, difficulty: difficulty.id, range: range.id, rng: () => value });
          assert.equal(exercise.level, level.id);
          assert.equal(exercise.difficulty, difficulty.id);
          assert.equal(exercise.range, range.id);
          assert.equal(exercise.target.length, level.length);
          assert.equal(exercise.positions.length, range.strings.length * (range.maxFret + 1));
          for (const [index, note] of exercise.target.entries()) {
            assert.ok(range.strings.includes(note.string));
            assert.ok(note.fret >= 0 && note.fret <= range.maxFret);
            assert.equal(note.midi, midiFor(note.string, note.fret));
            assert.equal(note.pc, note.midi % 12);
            if (index) {
              const distance = Math.abs(note.midi - exercise.target[index - 1].midi);
              assert.ok(distance >= 1 && distance <= difficulty.maxLeap);
            }
          }
        }
      }
    }
  }
});

test('three frozen difficulty presets expand pitch range and phrase leaps independently of note count', () => {
  assert.equal(Object.isFrozen(DIFFICULTIES), true);
  assert.deepEqual(DIFFICULTIES, [
    { id: 'easy', label: 'かんたん', range: 'low', maxLeap: 5 },
    { id: 'normal', label: 'ふつう', range: 'full', maxLeap: 12 },
    { id: 'hard', label: 'むずかしい', range: 'extended', maxLeap: 46 },
  ]);
  for (const difficulty of DIFFICULTIES) {
    assert.equal(Object.isFrozen(difficulty), true);
    const bounds = RANGES.find(range => range.id === difficulty.range);
    for (const level of LEVELS) {
      const exercise = makeExercise({ difficulty: difficulty.id, level: level.id, rng: sequence([0, 1]) });
      assert.equal(exercise.difficulty, difficulty.id);
      assert.equal(exercise.range, difficulty.range);
      assert.equal(exercise.target.length, level.length);
      assert.equal(exercise.positions.length, 6 * (bounds.maxFret + 1));
      if (level.length > 1) assert.equal(exercise.target[1].midi - exercise.target[0].midi, difficulty.maxLeap);
    }
    const lowest = makeExercise({ difficulty: difficulty.id, rng: () => 0 }).target[0].midi;
    const highest = makeExercise({ difficulty: difficulty.id, rng: () => 1 }).target[0].midi;
    assert.equal(lowest, 40);
    assert.equal(highest, 64 + bounds.maxFret);
  }
  assert.deepEqual(makeExercise().difficulty, 'normal');
  assert.deepEqual(makeExercise().range, 'full');
  const wide = makeExercise({ difficulty: 'hard', level: 'phrase', rng: sequence([0, 1]) });
  assert.deepEqual(wide.target.map(note => note.midi), [40, 86, 40, 86]);
});

test('range overrides remain supported and unknown ranges fall back to the selected difficulty', () => {
  for (const difficulty of DIFFICULTIES) {
    assert.equal(makeExercise({ difficulty: difficulty.id, range: 'invalid' }).range, difficulty.range);
    assert.equal(makeExercise({ difficulty: difficulty.id, range: 'first' }).range, 'first');
  }
  assert.equal(makeExercise({ difficulty: 'invalid' }).difficulty, 'normal');
  assert.equal(makeExercise({ difficulty: 'invalid' }).range, 'full');
});

test('every distinct chromatic pitch remains equally selectable in each range', () => {
  for (const range of RANGES) {
    const positions = allPositions(range);
    const distinct = [...new Set(positions.map(position => position.midi))].sort((a, b) => a - b);
    if (range.id !== 'first') assert.ok(positions.length > distinct.length);
    const selected = distinct.map((_, index) => makeExercise({ range: range.id, rng: () => (index + 0.5) / distinct.length }).target[0].midi);
    assert.deepEqual(selected, distinct);
    assert.deepEqual(distinct, Array.from({ length: distinct.length }, (_, index) => distinct[0] + index));
  }
});

test('an exercise avoids the preceding entire phrase even with deterministic random input', () => {
  for (const difficulty of DIFFICULTIES) {
    for (const range of RANGES) {
      for (const level of LEVELS) {
        const options = { difficulty: difficulty.id, level: level.id, range: range.id };
        const first = makeExercise({ ...options, rng: sequence([0.35, 0.71, 0.17, 0.48]) });
        const second = makeExercise({ ...options, previous: first.target, rng: sequence([0.35, 0.71, 0.17, 0.48]) });
        assert.notDeepEqual(second.target.map(note => note.midi), first.target.map(note => note.midi));
        const repeatedRng = makeExercise({ ...options, rng: () => 0 });
        const replacement = makeExercise({ ...options, previous: repeatedRng.target.map(note => note.midi), rng: () => 0 });
        assert.notDeepEqual(replacement.target.map(note => note.midi), repeatedRng.target.map(note => note.midi));
      }
    }
  }
});

test('matching positions honor absolute pitch and recompute location MIDI', () => {
  const result = matchingPositions(48, allPositions());
  assert.deepEqual(result.map(position => position.id).sort(), ['5-3', '6-8']);
  assert.deepEqual(matchingPositions(48, [{ ...at(5, 4), midi: 48 }, { ...at(6, 8), midi: -1 }]).map(position => position.id), ['6-8']);
  assert.deepEqual(matchingPositions(48, null), []);
  assert.deepEqual(matchingPositions(NaN, allPositions()), []);
});

test('extended ear range exposes all 22 frets and can generate every pitch above the old ceiling', () => {
  const range = RANGES.find(item => item.id === 'extended');
  assert.equal(range.label, '全弦・0–22F');
  assert.equal(range.maxFret, 22);
  assert.deepEqual(range.strings, [1, 2, 3, 4, 5, 6]);
  const exercise = makeExercise({ range: 'extended', rng: () => 1 });
  assert.equal(exercise.range, 'extended');
  assert.equal(exercise.positions.length, 138);
  assert.deepEqual(exercise.target, [at(1, 22)]);
  for (let string = 1; string <= 6; string++) {
    for (let fret = 13; fret <= 22; fret++) {
      assert.deepEqual(exercise.positions.find(p => p.id === `${string}-${fret}`), at(string, fret));
    }
  }
  // The distinct-pitch pool spans MIDI 40 through 86, including all ten newly
  // available pitches above 1st-string fret 12 (MIDI 76).
  for (let midi = 77; midi <= 86; midi++) {
    const sampled = makeExercise({ range: 'extended', rng: () => (midi - 40 + 0.5) / 47 });
    assert.deepEqual(sampled.target, [at(1, midi - 64)]);
  }
  assert.equal(makeExercise({ range: 'full' }).positions.length, 78);
  assert.equal(makeExercise().range, 'full');
});

test('grading and equivalent positions work above 12F while still rejecting other octaves', () => {
  const positions = allPositions({ maxFret: 22 });
  for (let string = 1; string <= 6; string++) {
    for (let fret = 13; fret <= 22; fret++) {
      const target = at(string, fret);
      assert.equal(gradeAnswer([target], [target]).correct, true);
      assert.equal(gradeAnswer([target], [at(string, fret - 12)]).correct, false);
      const equivalents = matchingPositions(target.midi, positions);
      assert.ok(equivalents.some(p => p.id === target.id));
      for (const equivalent of equivalents) {
        assert.equal(gradeAnswer([target], [equivalent]).correct, true);
      }
      if (string > 1) {
        const gap = string === 3 ? 4 : 5;
        assert.ok(equivalents.some(p => p.id === `${string - 1}-${fret - gap}`));
      }
    }
  }
  assert.equal(gradeAnswer([at(1, 22)], [{ ...at(1, 21), midi: 86 }]).correct, false);
});

test('unknown settings use defaults and returned targets do not alias their position pool', () => {
  const exercise = makeExercise({ level: 'unknown', range: 'unknown', rng: () => NaN });
  assert.equal(exercise.level, 'single');
  assert.equal(exercise.range, 'full');
  assert.equal(exercise.difficulty, 'normal');
  const original = exercise.positions.find(position => position.id === exercise.target[0].id);
  exercise.target[0].fret = 99;
  assert.notEqual(original.fret, 99);
});

const pitches = exercise => exercise.target.map(note => note.midi);

test('legacy scale and tonic arguments never affect random exercises or their previous-phrase exclusion', () => {
  const randomValues = [0.13, 0.86, 0.31, 0.67];
  for (const range of RANGES) {
    for (const level of LEVELS) {
      const settings = { range: range.id, level: level.id };
      const expected = makeExercise({ ...settings, rng: sequence(randomValues) });
      assert.deepEqual(Object.keys(expected).sort(), ['difficulty', 'level', 'positions', 'range', 'target']);
      const expectedNext = makeExercise({ ...settings, previous: expected.target, rng: sequence(randomValues) });
      assert.notDeepEqual(pitches(expectedNext), pitches(expected));
      for (const style of ['chromatic', 'major', 'pentatonic', 'blues', 'unknown']) {
        for (let tonic = 0; tonic < 12; tonic++) {
          assert.deepEqual(makeExercise({ ...settings, style, tonic, rng: sequence(randomValues) }), expected);
          assert.deepEqual(makeExercise({ ...settings, style, tonic, previous: expected.target, rng: sequence(randomValues) }), expectedNext);
        }
      }
    }
  }
  assert.deepEqual(pitches(makeExercise({ level: 'phrase', difficulty: 'easy', rng: () => 0.4 })), [52, 51, 50, 49]);
});

test('random phrase positions never alias the position pool or repeated occurrences', () => {
  const exercise = makeExercise({ level: 'phrase', range: 'first', rng: () => 0 });
  const before = pitches(exercise);
  assert.equal(before[0], before[2]);
  const id = exercise.target[0].id;
  exercise.target[0].midi = -1;
  assert.equal(exercise.positions.find(position => position.id === id).midi, before[0]);
  assert.deepEqual(exercise.target.slice(1).map(note => note.midi), before.slice(1));
});
