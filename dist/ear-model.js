/** Sound-first exercises. Kept separate from position-memory progress. */
import { allPositions, midiFor } from './engine.js';

export const LEVELS = Object.freeze([
  Object.freeze({ id: 'single', label: '1音', length: 1 }),
  Object.freeze({ id: 'pair', label: '2音', length: 2 }),
  Object.freeze({ id: 'triple', label: '3音', length: 3 }),
  Object.freeze({ id: 'phrase', label: '4音', length: 4 }),
]);

export const RANGES = Object.freeze([
  Object.freeze({ id: 'first', label: '1弦・0–5F', strings: Object.freeze([1]), maxFret: 5 }),
  Object.freeze({ id: 'low', label: '全弦・0–5F', strings: Object.freeze([1, 2, 3, 4, 5, 6]), maxFret: 5 }),
  Object.freeze({ id: 'full', label: '全弦・0–12F', strings: Object.freeze([1, 2, 3, 4, 5, 6]), maxFret: 12 }),
  Object.freeze({ id: 'extended', label: '全弦・0–22F', strings: Object.freeze([1, 2, 3, 4, 5, 6]), maxFret: 22 }),
]);

function pitch(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 127 ? value : null;
  if (!value || typeof value !== 'object') return null;
  try {
    // The physical location is authoritative; do not trust a supplied midi field.
    return midiFor(value.string, value.fret);
  } catch {
    return null;
  }
}

function pick(items, rng) {
  const value = rng();
  const unit = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return items[Math.min(items.length - 1, Math.floor(unit * items.length))];
}

export function makeExercise({ level = 'single', range = 'first', previous = [], rng = Math.random } = {}) {
  const difficulty = LEVELS.find(item => item.id === level) || LEVELS[0];
  const bounds = RANGES.find(item => item.id === range) || RANGES[0];
  const positions = allPositions(bounds);
  // Each pitch gets one lottery entry, even when it occurs on several strings.
  const byPitch = new Map();
  for (const position of positions) {
    if (!byPitch.has(position.midi)) byPitch.set(position.midi, position);
  }
  const midis = [...byPitch.keys()].sort((a, b) => a - b);
  const prior = Array.isArray(previous) ? previous.map(pitch) : [];
  const random = typeof rng === 'function' ? rng : Math.random;
  const target = [];
  for (let index = 0; index < difficulty.length; index += 1) {
    const last = target.at(-1)?.midi;
    let candidates = last === undefined ? midis : midis.filter(midi => midi !== last && Math.abs(midi - last) <= 5);
    if (!candidates.length) candidates = midis;
    // Exclude a complete repeat only at its final note. No retry loop is needed,
    // so even a deterministic RNG terminates and produces a different exercise.
    if (index === difficulty.length - 1 && prior.length === difficulty.length
      && target.every((position, i) => position.midi === prior[i])) {
      const alternatives = candidates.filter(midi => midi !== prior[index]);
      if (alternatives.length) candidates = alternatives;
    }
    target.push({ ...byPitch.get(pick(candidates, random)) });
  }
  return { target, positions, level: difficulty.id, range: bounds.id };
}

export function gradeAnswer(target, answer) {
  const expected = Array.isArray(target) ? target : [];
  const supplied = Array.isArray(answer) ? answer : [];
  const matches = expected.map((position, index) => {
    const expectedMidi = pitch(position);
    return expectedMidi !== null && expectedMidi === pitch(supplied[index]);
  });
  const complete = expected.length > 0 && supplied.length === expected.length;
  return { correct: complete && matches.every(Boolean), complete, matches };
}

export function matchingPositions(midi, positions) {
  return Number.isInteger(midi) && Array.isArray(positions)
    ? positions.filter(position => pitch(position) === midi)
    : [];
}
