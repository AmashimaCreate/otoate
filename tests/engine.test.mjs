import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_SHARP, NOTES_FLAT, noteName, midiFor, pitchClass, allPositions, createProgress, sanitizeProgress, chooseQuestion, recordAnswer, masteryFor, getStats, relationshipHint } from '../dist/engine.js';

const position = (id) => allPositions().find((p) => p.id === id);

test('standard tuning, chromatic wrap, and both enharmonic spellings', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((s) => midiFor(s, 0)), [64, 59, 55, 50, 45, 40]);
  assert.equal(pitchClass(6, 8), 0);
  assert.equal(noteName(13), 'C♯');
  assert.equal(noteName(-1), 'B');
  assert.equal(noteName(1, true), 'D♭');
  assert.equal(NOTES_SHARP.length, 12);
  assert.equal(NOTES_FLAT.length, 12);
  assert.throws(() => midiFor(0, 1), RangeError);
  assert.throws(() => midiFor(1, -1), RangeError);
  assert.throws(() => midiFor(1, 1.5), RangeError);
});

test('position ranges are unique, bounded, and filter natural notes correctly', () => {
  assert.equal(allPositions().length, 78);
  assert.equal(allPositions({ maxFret: 5 }).length, 36);
  const notes = allPositions({ maxFret: 5, strings: [6, 6, 2, 9], naturalsOnly: true });
  assert.ok(notes.every((p) => [6, 2].includes(p.string) && p.fret <= 5));
  assert.ok(notes.every((p) => [0, 2, 4, 5, 7, 9, 11].includes(p.pc)));
  assert.equal(new Set(notes.map((p) => p.id)).size, notes.length);
  assert.deepEqual(allPositions({ strings: [] }), []);
});

test('explicit extended positions include frets 13–22 on every string with correct pitch', () => {
  const extended = allPositions({ maxFret: 22 });
  const openMidis = [64, 59, 55, 50, 45, 40];
  assert.equal(extended.length, 138);
  assert.equal(new Set(extended.map(p => p.id)).size, 138);
  for (let string = 1; string <= 6; string++) {
    for (let fret = 13; fret <= 22; fret++) {
      const midi = openMidis[string - 1] + fret;
      assert.deepEqual(extended.find(p => p.id === `${string}-${fret}`), {
        id: `${string}-${fret}`, string, fret, midi, pc: midi % 12,
      });
      assert.equal(midiFor(string, fret), midi);
      assert.equal(pitchClass(string, fret), midi % 12);
      assert.equal(midiFor(string, fret) - midiFor(string, fret - 12), 12);
    }
  }
  assert.deepEqual(allPositions({ maxFret: 99 }), extended);
  const naturals = allPositions({ maxFret: 22, strings: [1, 6], naturalsOnly: true });
  assert.ok(naturals.some(p => p.fret === 22));
  assert.ok(naturals.every(p => [1, 6].includes(p.string) && p.fret <= 22 && [0, 2, 4, 5, 7, 9, 11].includes(p.pc)));
});

test('extended capability leaves default ranges and saved main-app progress bounded at 12F', () => {
  const standard = allPositions({ maxFret: 12 });
  assert.equal(standard.length, 78);
  assert.deepEqual(allPositions(), standard);
  for (const maxFret of [undefined, NaN, Infinity, '22']) {
    assert.deepEqual(allPositions({ maxFret }), standard);
  }
  assert.equal(getStats(createProgress()).total, 78);
  const restored = sanitizeProgress({ cards: {
    '1-12': { seen: 1, correct: 1 },
    '1-13': { seen: 1, correct: 1 },
    '6-22': { seen: 1, correct: 1 },
  } });
  assert.deepEqual(Object.keys(restored.cards), ['1-12']);
});

test('one right answer does not mean mastered; intervals require spaced retrieval', () => {
  const progress = createProgress();
  const p = position('6-5');
  let now = 1_000_000;
  recordAnswer(progress, p, { correct: true, elapsedMs: 2400, now });
  assert.equal(progress.cards[p.id].level, 1);
  assert.equal(progress.cards[p.id].dueAt, now + 300_000);
  assert.equal(masteryFor(progress, p.id), 0.2);
  recordAnswer(progress, p, { correct: true, now: now + 10 });
  assert.equal(progress.cards[p.id].level, 1);
  for (let level = 2; level <= 5; level++) {
    now = progress.cards[p.id].dueAt;
    recordAnswer(progress, p, { correct: true, now });
    assert.equal(progress.cards[p.id].level, level);
  }
  assert.equal(masteryFor(progress, p.id), 1);
  assert.equal(progress.totalAnswers, 6);
  assert.equal(progress.totalCorrect, 6);
});

test('wrong answers and hints prompt short retrieval without inflating mastery', () => {
  const progress = createProgress();
  const p = position('2-8');
  recordAnswer(progress, p, { correct: true, assisted: true, now: 1_000 });
  assert.equal(progress.cards[p.id].level, 0);
  assert.equal(progress.cards[p.id].streak, 0);
  assert.equal(progress.cards[p.id].dueAt, 91_000);
  recordAnswer(progress, p, { correct: false, now: 2_000, elapsedMs: Infinity });
  assert.equal(progress.cards[p.id].dueAt, 47_000);
  assert.equal(progress.cards[p.id].correct, 1);
  assert.equal(progress.cards[p.id].totalMs, 0);
  for (let i = 0; i < 4; i++) recordAnswer(progress, p, { correct: true, now: progress.cards[p.id].dueAt });
  assert.equal(progress.cards[p.id].level, 4);
  recordAnswer(progress, p, { correct: false, now: progress.cards[p.id].dueAt });
  assert.equal(progress.cards[p.id].level, 2);
});

test('question selection respects settings, review queue, and recent history', () => {
  const progress = createProgress();
  const settings = { maxFret: 5, strings: [6], naturalsOnly: true };
  const q = chooseQuestion(progress, settings, [], ['1-8', '6-5']);
  assert.equal(q.id, '6-5');
  assert.equal(q.reason, 'review');
  assert.notEqual(chooseQuestion(progress, settings, ['6-5'], ['6-5']).id, '6-5');
  for (let i = 0; i < 40; i++) {
    const selected = chooseQuestion(progress, settings);
    assert.equal(selected.string, 6);
    assert.ok(selected.fret <= 5);
    assert.ok([0, 2, 4, 5, 7, 9, 11].includes(selected.pc));
  }
  assert.equal(chooseQuestion(progress, { strings: [] }), null);
  assert.equal(chooseQuestion(progress, { strings: [1], maxFret: 0 }, ['1-0']).id, '1-0');
});

test('due cards take priority while discovery receives a regular turn', () => {
  const progress = createProgress();
  recordAnswer(progress, position('6-0'), { correct: false, now: 1 });
  assert.equal(chooseQuestion(progress, { strings: [6] }).id, '6-0');
  assert.equal(chooseQuestion(progress, { strings: [6] }).reason, 'review');
  progress.totalAnswers = 3;
  assert.equal(chooseQuestion(progress, { strings: [6] }).reason, 'new');
});

test('storage sanitation repairs contradictory counts, bad values, and polluted keys', () => {
  for (const value of [null, undefined, 'broken', 42, []]) assert.deepEqual(sanitizeProgress(value), createProgress());
  const corrupt = JSON.parse('{"cards":{"6-5":{"seen":3,"correct":9,"streak":8,"level":99,"dueAt":-1,"lastSeen":"bad","totalMs":1e300},"1-99":{"seen":4},"__proto__":{"seen":4},"1-1":{"seen":null}},"totalAnswers":999,"sessions":[null, {"completedAt":123,"__proto__":{"polluted":true}}]}');
  const clean = sanitizeProgress(corrupt);
  assert.deepEqual(Object.keys(clean.cards), ['6-5']);
  assert.equal(clean.totalAnswers, 3);
  assert.equal(clean.totalCorrect, 3);
  assert.equal(clean.cards['6-5'].level, 3);
  assert.equal(clean.cards['6-5'].dueAt, 0);
  assert.equal(clean.cards['6-5'].totalMs, 360_000);
  assert.equal(clean.sessions.length, 1);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(sanitizeProgress(clean), clean);
});

test('stats correspond to selected learning range and completed activity dates', () => {
  const progress = createProgress();
  const today = Date.now();
  recordAnswer(progress, position('6-5'), { correct: true, elapsedMs: 2_000, now: today });
  recordAnswer(progress, position('6-5'), { correct: false, elapsedMs: 4_000, now: today });
  recordAnswer(progress, position('1-8'), { correct: true, elapsedMs: 1_000, now: today });
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  progress.sessions.push({ completedAt: yesterday.getTime() });
  const stats = getStats(progress, { strings: [6], maxFret: 5 });
  assert.equal(stats.seen, 1);
  assert.equal(stats.total, 6);
  assert.equal(stats.accuracy, 50);
  assert.equal(stats.averageSeconds, 3);
  assert.equal(stats.mastered, 0);
  assert.equal(stats.streakDays, 2);
});

test('partial sessions preserve daily streaks when the same card is revisited', () => {
  const progress = createProgress();
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  recordAnswer(progress, position('6-5'), { correct: false, now: yesterday.getTime() });
  // A reload followed by another answer to this card must not erase yesterday.
  const restored = sanitizeProgress(JSON.parse(JSON.stringify(progress)));
  recordAnswer(restored, position('6-5'), { correct: true, now: today.getTime() });
  recordAnswer(restored, position('6-5'), { correct: true, now: today.getTime() + 100 });
  assert.equal(restored.sessions.length, 0);
  assert.equal(restored.activityDays.length, 2);
  assert.equal(getStats(restored).streakDays, 2);
  assert.equal(getStats(sanitizeProgress(restored)).streakDays, 2);
});

test('activity day sanitation validates calendar dates and migrates older records', () => {
  const clean = sanitizeProgress({ activityDays: ['2026-02-30', '2026-01-01', '2026-01-01', null, {}, 'bad', '2026-1-2', '2026-02-28'] });
  assert.deepEqual(clean.activityDays, ['2026-01-01', '2026-02-28']);
  const old = createProgress();
  const stamp = new Date(2026, 9, 6, 12).getTime();
  recordAnswer(old, position('6-5'), { correct: true, now: stamp });
  delete old.activityDays;
  assert.deepEqual(sanitizeProgress(old).activityDays, ['2026-10-06']);
});

test('every octave hint identifies a pitch-equivalent anchor including the B-string offset', () => {
  for (const p of allPositions()) {
    const hint = relationshipHint(p);
    assert.ok(hint.title && hint.body && hint.label);
    assert.equal(hint.anchor.midi, midiFor(hint.anchor.string, hint.anchor.fret));
    if (hint.title.includes('オクターブ') || p.fret === 12) {
      assert.equal(p.pc, hint.anchor.pc);
      assert.equal(p.midi - hint.anchor.midi, 12);
    }
  }
  assert.deepEqual(relationshipHint(position('2-5')).anchor, { string: 4, fret: 2, midi: 52, pc: 4 });
  assert.deepEqual(relationshipHint(position('3-5')).anchor, { string: 5, fret: 3, midi: 48, pc: 0 });
});

test('relationship hints follow the chosen accidental spelling', () => {
  const p = position('2-7');
  assert.match(relationshipHint(p).body, /F♯/);
  const flat = relationshipHint(p, true);
  assert.match(flat.body, /G♭/);
  assert.doesNotMatch(flat.body, /F♯/);
  assert.equal(flat.anchor.pc, p.pc);
  assert.match(relationshipHint(position('6-2'), true).body, /G♭/);
});
