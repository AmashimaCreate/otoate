/** One note, six strings: discovery → reverse recall → transfer. */
import { allPositions, midiFor, pitchClass, noteName } from './engine.js';

export const ROOTS = Object.freeze([0, 2, 4, 5, 7, 9, 11]);
const mod12 = (value) => ((value % 12) + 12) % 12;
const validPc = (value) => {
  if (!Number.isInteger(value)) throw new TypeError('音名は整数のピッチクラスで指定してください。');
  return mod12(value);
};

export function makePosition(string, fret) {
  return { id: `${string}-${fret}`, string, fret, midi: midiFor(string, fret), pc: pitchClass(string, fret) };
}

export function candidatesFor(rootPc, string, maxFret = 12) {
  const root = validPc(rootPc);
  return allPositions({ strings: [string], maxFret }).filter((position) => position.pc === root);
}

export function createJourney(rootPc = 0) {
  const root = validPc(rootPc);
  const anchors = candidatesFor(root, 6);
  return {
    rootPc: root, phase: 'discover', activeString: 5,
    route: [anchors.find((position) => position.fret > 0) ?? anchors[0]],
    recall: [], transferIndex: 0, transferAnswers: [], mistakes: 0, hints: 0,
    recallCorrect: 0, recallAttempts: 0, currentAssisted: false, done: false,
  };
}

function targetFor(state) {
  if (!state.activeString) return null;
  return state.route.find((position) => position.string === state.activeString)
    ?? candidatesFor(state.rootPc, state.activeString)[0];
}

/** Count a revealed hint once per location, even if its button is pressed again. */
export function markHint(state) {
  if (state.activeString && !state.currentAssisted && ['discover', 'recall'].includes(state.phase)) {
    state.hints += 1;
    state.currentAssisted = true;
  }
  return targetFor(state);
}

/** Mutates only the supplied journey; positions are reconstructed, never trusted. */
export function advancePosition(state, position) {
  const result = { accepted: false, correct: false, completedPhase: false, message: '' };
  if (!state || !['discover', 'recall'].includes(state.phase) || !state.activeString || state.done) {
    return { ...result, message: '次のステップへ進んでください。' };
  }
  if (!position || !Number.isInteger(position.fret) || position.fret < 0 || position.fret > 12
      || position.string !== state.activeString) {
    return { ...result, message: `${state.activeString}弦で ${noteName(state.rootPc)} を探そう。`, target: targetFor(state) };
  }
  const picked = makePosition(position.string, position.fret);
  result.accepted = true;
  if (state.phase === 'recall') state.recallAttempts += 1;
  if (picked.pc !== state.rootPc) {
    state.mistakes += 1;
    return { ...result, message: `そこは ${noteName(picked.pc)}。探しているのは ${noteName(state.rootPc)}。`, target: targetFor(state) };
  }
  const path = state.phase === 'discover' ? state.route : state.recall;
  const previous = path.at(-1);
  path.push(picked);
  result.correct = true;
  result.assisted = state.currentAssisted;
  result.message = previous ? describeMove(previous, picked) : `${noteName(picked.pc)} を見つけた。`;
  if (state.phase === 'recall') state.recallCorrect += 1;
  state.currentAssisted = false;
  const next = state.activeString + (state.phase === 'discover' ? -1 : 1);
  state.activeString = next >= 1 && next <= 6 ? next : null;
  result.completedPhase = state.activeString === null;
  result.target = targetFor(state);
  return result;
}

export function beginRecall(state) {
  if (state.phase !== 'discover' || state.activeString !== null || state.route.length !== 6) {
    throw new Error('6本の弦で音を見つけてから、逆向きの練習に進みます。');
  }
  state.phase = 'recall';
  state.recall = [{ ...state.route.at(-1) }];
  state.activeString = 2;
  state.currentAssisted = false;
  return state;
}

function learnedPosition(state, string) {
  const position = state.route.find((item) => item.string === string);
  if (!position) throw new Error('先に6本の弦をつないでください。');
  return position;
}

export function makeTransfers(state) {
  const third = learnedPosition(state, 3);
  const second = learnedPosition(state, 2);
  const lower = makePosition(3, mod12(third.fret - 1));
  const higher = makePosition(2, mod12(second.fret + 2));
  const targetPc = mod12(state.rootPc + 2);
  const lowerOctaveShift = (lower.midi - third.midi + 1) / 12;
  const higherOctaveShift = (higher.midi - second.midi - 2) / 12;
  return [
    {
      kind: 'name', position: lower, answerPc: lower.pc, pc: lower.pc,
      anchor: third, offset: -1, octaveShift: lowerOctaveShift,
      prompt: `${noteName(state.rootPc)} の半音下と同じ音名。この場所の音名は？`,
      explanation: `${describeMove(third, lower)}${lowerOctaveShift ? ' 半音下の音を1オクターブ上の位置で探しています。' : ''}`,
    },
    {
      kind: 'name', position: higher, answerPc: higher.pc, pc: higher.pc,
      anchor: second, offset: 2, octaveShift: higherOctaveShift,
      prompt: `${noteName(state.rootPc)} の全音上と同じ音名。この場所の音名は？`,
      explanation: `${describeMove(second, higher)}${higherOctaveShift ? ' 全音上の音を1オクターブ下の位置で探しています。' : ''}`,
    },
    {
      kind: 'locate', string: 6, pc: targetPc, answerPc: targetPc,
      anchor: higher,
      prompt: `今見つけた ${noteName(targetPc)} を、6弦でも探そう。`,
    },
  ];
}

export function createSequence(state) {
  const anchor = learnedPosition(state, 3);
  // Keep the phrase near the discovered note, including its actual octave.
  // At either edge of the visible neck, turn inward instead of wrapping 12 frets.
  const offsets = anchor.fret === 0 ? [0, 2, 0, 2]
    : anchor.fret >= 11 ? [0, -1, 0, -1]
      : [0, -1, 2, 0];
  return offsets.map((offset) => makePosition(3, anchor.fret + offset));
}

export function describeMove(from, to) {
  const a = makePosition(from.string, from.fret);
  const b = makePosition(to.string, to.fret);
  const semitones = b.midi - a.midi;
  let relation;
  if (semitones === 0) relation = `音名も高さも同じ ${noteName(b.pc)}。`;
  else if (Math.abs(semitones) % 12 === 0) {
    relation = `同じ音名 ${noteName(b.pc)}。高さは${Math.abs(semitones) / 12}オクターブ${semitones > 0 ? '上' : '下'}。`;
  } else relation = `${noteName(a.pc)} から ${noteName(b.pc)} へ、${Math.abs(semitones)}半音${semitones > 0 ? '上がる' : '下がる'}。`;
  const strings = b.string - a.string;
  const frets = b.fret - a.fret;
  const movement = strings === 0 ? '同じ弦で' : `${strings < 0 ? '細い' : '太い'}弦へ${Math.abs(strings)}本、`;
  const fretMove = frets === 0 ? 'フレットは同じ。' : `フレットを${Math.abs(frets)}つ${frets > 0 ? '上げる' : '下げる'}。`;
  const crossesB = Math.min(a.string, b.string) <= 2 && Math.max(a.string, b.string) >= 3;
  const tuning = crossesB ? ' 3弦と2弦の開放弦は4半音差。ほかの隣り合う弦の5半音差とは1つ違う。' : '';
  return `${relation}${movement}${fretMove}${tuning}`;
}

export function parseNote(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim().normalize('NFKC').replace(/♯/g, '#').replace(/♭/g, 'b');
  const match = /^(C|D|E|F|G|A|B|ド|レ|ミ|ファ|ソ|ラ|シ)([#b]?)$/i.exec(cleaned);
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, ド: 0, レ: 2, ミ: 4, ファ: 5, ソ: 7, ラ: 9, シ: 11 }[match[1].toUpperCase()];
  return mod12(base + (match[2] === '#' ? 1 : match[2].toLowerCase() === 'b' ? -1 : 0));
}
