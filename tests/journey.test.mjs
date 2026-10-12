import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOTS, makePosition, candidatesFor, createJourney, advancePosition, beginRecall, markHint, makeTransfers, createSequence, describeMove, parseNote } from '../dist/journey.js';

function discover(root, choose = (positions) => positions[0]) {
  const journey = createJourney(root);
  for (let string = 5; string >= 1; string--) {
    const result = advancePosition(journey, choose(candidatesFor(root, string)));
    assert.equal(result.correct, true);
    assert.equal(result.completedPhase, string === 1);
  }
  return journey;
}

test('every pitch class forms a six-string route and a reverse recall', () => {
  assert.deepEqual(ROOTS, [0, 2, 4, 5, 7, 9, 11]);
  assert.equal(createJourney().rootPc, 0);
  for (let root = 0; root < 12; root++) {
    const state = discover(root);
    assert.deepEqual(state.route.map((p) => p.string), [6, 5, 4, 3, 2, 1]);
    assert.ok(state.route.every((p) => p.pc === root));
    assert.equal(state.phase, 'discover');
    assert.equal(state.activeString, null);
    beginRecall(state);
    for (let string = 2; string <= 6; string++) {
      assert.equal(state.activeString, string);
      const result = advancePosition(state, candidatesFor(root, string)[0]);
      assert.equal(result.completedPhase, string === 6);
    }
    assert.deepEqual(state.recall.map((p) => p.string), [1, 2, 3, 4, 5, 6]);
    assert.equal(state.recallCorrect, 5);
    assert.equal(state.recallAttempts, 5);
    assert.equal(state.phase, 'recall');
    assert.equal(state.done, false);
  }
});

test('wrong string and malformed positions do not count; wrong notes do', () => {
  const state = createJourney();
  assert.equal(advancePosition(state, makePosition(4, 10)).accepted, false);
  assert.equal(advancePosition(state, { string: 5, fret: -1 }).accepted, false);
  assert.equal(advancePosition(state, { string: 5, fret: 13 }).accepted, false);
  assert.equal(state.mistakes, 0);
  assert.equal(advancePosition(state, { string: 5, fret: 1, pc: 0 }).correct, false);
  assert.equal(state.mistakes, 1);
  assert.equal(state.route.length, 1);
  assert.equal(state.activeString, 5);
  assert.throws(() => beginRecall(state));
});

test('recall counts wrong attempts and hints independently of correct answers', () => {
  const state = discover(0);
  beginRecall(state);
  assert.equal(markHint(state).pc, 0);
  markHint(state);
  assert.equal(state.hints, 1);
  advancePosition(state, makePosition(2, 2));
  assert.equal(state.recallAttempts, 1);
  assert.equal(state.recallCorrect, 0);
  const result = advancePosition(state, makePosition(2, 1));
  assert.equal(result.assisted, true);
  assert.equal(state.recallAttempts, 2);
  assert.equal(state.recallCorrect, 1);
  assert.equal(state.currentAssisted, false);
  markHint(state);
  assert.equal(state.hints, 2);
});

test('open and twelfth-fret alternatives are both accepted and recorded', () => {
  assert.equal(createJourney(4).route[0].fret, 12);
  assert.deepEqual(candidatesFor(9, 5).map((p) => p.fret), [0, 12]);
  for (const fret of [0, 12]) {
    const state = createJourney(9);
    assert.equal(advancePosition(state, makePosition(5, fret)).correct, true);
    assert.equal(state.route[1].fret, fret);
  }
  const state = discover(4, (positions) => positions.at(-1));
  beginRecall(state);
  for (let string = 2; string <= 6; string++) advancePosition(state, candidatesFor(4, string)[0]);
  assert.equal(state.route[0].fret, 12);
  assert.equal(state.recall.at(-1).fret, 0);
});

test('transfer questions and phrase have correct pitch math for all roots and open/12 choices', () => {
  for (let root = 0; root < 12; root++) {
    for (const pick of [(p) => p[0], (p) => p.at(-1)]) {
      const state = discover(root, pick);
      const [lower, higher, locate] = makeTransfers(state);
      assert.equal(lower.answerPc, (root + 11) % 12);
      assert.equal(higher.answerPc, (root + 2) % 12);
      assert.equal(locate.pc, higher.answerPc);
      assert.equal(locate.string, 6);
      assert.equal(lower.anchor, state.route.find((p) => p.string === 3));
      assert.equal(higher.anchor, state.route.find((p) => p.string === 2));
      assert.equal(locate.anchor, higher.position);
      for (const task of [lower, higher]) {
        assert.ok(task.position.fret >= 0 && task.position.fret <= 12);
        assert.equal(task.position.midi % 12, task.answerPc);
        assert.equal(task.position.midi - task.anchor.midi, task.offset + task.octaveShift * 12);
      }
      const anchor = state.route.find((p) => p.string === 3);
      const offsets = anchor.fret === 0 ? [0, 2, 0, 2] : anchor.fret >= 11 ? [0, -1, 0, -1] : [0, -1, 2, 0];
      const sequence = createSequence(state);
      assert.deepEqual(sequence.map((p) => p.midi), offsets.map((offset) => anchor.midi + offset));
      assert.ok(sequence.every((p) => p.string === 3 && p.fret >= 0 && p.fret <= 12));
      assert.ok(sequence.slice(1).every((p, i) => Math.abs(p.midi - sequence[i].midi) <= 3));
    }
  }
});

test('ear phrases preserve the chosen root octave and turn inward at neck edges', () => {
  for (const [root, choose, expected] of [
    [7, (p) => p[0], [0, 2, 0, 2]],
    [7, (p) => p.at(-1), [12, 11, 12, 11]],
    [6, (p) => p[0], [11, 10, 11, 10]],
    [5, (p) => p[0], [10, 9, 12, 10]],
    [8, (p) => p[0], [1, 0, 3, 1]],
  ]) {
    const state = discover(root, choose);
    assert.deepEqual(createSequence(state).map((p) => p.fret), expected);
  }
});

test('movement distinguishes unison, octave, semitone, and the B-string tuning', () => {
  assert.match(describeMove(makePosition(6, 8), makePosition(5, 3)), /音名も高さも同じ C/);
  assert.match(describeMove(makePosition(6, 8), makePosition(4, 10)), /1オクターブ上/);
  assert.match(describeMove(makePosition(3, 5), makePosition(3, 4)), /1半音下がる/);
  assert.match(describeMove(makePosition(3, 5), makePosition(2, 1)), /開放弦は4半音差/);
  assert.match(describeMove(makePosition(2, 1), makePosition(3, 5)), /開放弦は4半音差/);
});

test('note parsing covers solfege, enharmonic accidentals, and rejects stray input', () => {
  const cases = { C: 0, ' c# ': 1, Db: 1, 'D♭': 1, 'Ｆ＃': 6, ド: 0, 'レ♭': 1, 'ミ♯': 5, ファ: 5, 'ソ#': 8, ラ: 9, シ: 11, 'B#': 0, Cb: 11, Fb: 4, 'E#': 5 };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseNote(input), expected, input);
  for (const input of ['', 'H', 'C##', 'C4', 'Do', 'ファ#x', 'A B', null, 0]) assert.equal(parseNote(input), null);
});
