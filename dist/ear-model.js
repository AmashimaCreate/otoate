/** Random listening exercises and absolute-pitch answer grading. */
import { allPositions, midiFor } from './pitch.js';

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

export const DIFFICULTIES = Object.freeze([
  Object.freeze({ id: 'easy', label: 'かんたん', minSpan: 1, maxSpan: 12 }),
  Object.freeze({ id: 'normal', label: 'ふつう', minSpan: 13, maxSpan: 24 }),
  Object.freeze({ id: 'hard', label: 'むずかしい', minSpan: 25, maxSpan: 46 }),
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

function phraseOrderings(notes, prefix = []) {
  if (!notes.length) return [prefix];
  const orderings = [];
  const used = new Set();
  for (const [index, midi] of notes.entries()) {
    if (midi === prefix.at(-1) || used.has(midi)) continue;
    used.add(midi);
    orderings.push(...phraseOrderings(notes.filter((_, i) => i !== index), [...prefix, midi]));
  }
  return orderings;
}

export function makeExercise({ level = 'single', difficulty = 'normal', range, previous = [], rng = Math.random } = {}) {
  const noteCount = LEVELS.find(item => item.id === level) || LEVELS[0];
  const preset = DIFFICULTIES.find(item => item.id === difficulty) || DIFFICULTIES[1];
  const bounds = RANGES.find(item => item.id === range) || RANGES.find(item => item.id === 'extended');
  const positions = allPositions(bounds);
  // Each pitch gets one lottery entry, even when it occurs on several strings.
  const byPitch = new Map();
  for (const position of positions) {
    if (!byPitch.has(position.midi)) byPitch.set(position.midi, position);
  }
  const midis = [...byPitch.keys()].sort((a, b) => a - b);
  const prior = Array.isArray(previous) ? previous.map(pitch) : [];
  const random = typeof rng === 'function' ? rng : Math.random;
  let selected;
  if (noteCount.length === 1) {
    const candidates = prior.length === 1 ? midis.filter(midi => midi !== prior[0]) : midis;
    selected = [pick(candidates.length ? candidates : midis, random)];
  } else {
    // Choose the audible span itself, then include both endpoints. A maximum
    // leap alone would still allow most questions to stay inside one octave.
    const availableSpan = midis.at(-1) - midis[0];
    const minSpan = Math.min(preset.minSpan, availableSpan);
    const maxSpan = Math.min(preset.maxSpan, availableSpan);
    const spans = Array.from({ length: maxSpan - minSpan + 1 }, (_, index) => minSpan + index);
    const span = pick(spans, random);
    const low = pick(midis.filter(midi => byPitch.has(midi + span)), random);
    const high = low + span;
    const inside = midis.filter(midi => midi >= low && midi <= high);
    const notes = [low, high];
    while (notes.length < noteCount.length) {
      notes.push(pick(inside.filter(midi => midi !== notes.at(-1)), random));
    }
    // At most 24 permutations for four notes: bounded work, no rejection loop.
    // Shuffling avoids always revealing the span in the first two notes.
    const orderings = phraseOrderings(notes);
    const alternatives = orderings.filter(order => order.length !== prior.length || order.some((midi, index) => midi !== prior[index]));
    selected = pick(alternatives.length ? alternatives : orderings, random);
    if (!alternatives.length) {
      // A three-note [low, high, low] phrase can have only one valid ordering.
      // Swapping its endpoints preserves the span and prevents an exact repeat.
      selected = selected.map(midi => midi === low ? high : midi === high ? low : midi);
    }
  }
  const target = selected.map(midi => ({ ...byPitch.get(midi) }));
  return { target, positions, level: noteCount.id, difficulty: preset.id, range: bounds.id };
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
