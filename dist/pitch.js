/** Standard-tuning pitch math. No practice state, storage, or UI dependencies. */
const NOTES_SHARP = Object.freeze(['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
const NOTES_FLAT = Object.freeze(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']);
const OPEN = [0, 64, 59, 55, 50, 45, 40];
const NATURALS = new Set([0, 2, 4, 5, 7, 9, 11]);
const safeInt = (value, fallback = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;

export function noteName(pc, flats = false) {
  return (flats ? NOTES_FLAT : NOTES_SHARP)[((Math.trunc(pc) % 12) + 12) % 12] ?? '—';
}

export function midiFor(string, fret) {
  if (!Number.isInteger(string) || string < 1 || string > 6 || !Number.isInteger(fret) || fret < 0 || fret > 24) {
    throw new RangeError('弦は1〜6、フレットは0〜24で指定してください。');
  }
  return OPEN[string] + fret;
}

export function allPositions({ maxFret = 12, strings = [1, 2, 3, 4, 5, 6], naturalsOnly = false } = {}) {
  const limit = Math.min(22, safeInt(maxFret, 12));
  const selected = Array.isArray(strings) ? [...new Set(strings)].filter((s) => Number.isInteger(s) && s >= 1 && s <= 6) : [1, 2, 3, 4, 5, 6];
  const positions = [];
  for (const string of selected) {
    for (let fret = 0; fret <= limit; fret += 1) {
      const midi = midiFor(string, fret);
      const pc = midi % 12;
      if (!naturalsOnly || NATURALS.has(pc)) positions.push({ id: `${string}-${fret}`, string, fret, midi, pc });
    }
  }
  return positions;
}
