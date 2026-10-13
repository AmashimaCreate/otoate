import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { noteName, midiFor } from '../dist/pitch.js';
import { LEVELS, RANGES, DIFFICULTIES, makeExercise, gradeAnswer, matchingPositions } from '../dist/ear-model.js';
import { runSequence } from '../dist/ear-playback.js';

const html = readFileSync(new URL('../dist/ear.html', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../dist/ear.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Run the actual screen controller with an audio clock we can interrupt. The
// minimal DOM records control state; layout and hit targets are checked in-browser.
function screen(level = 'phrase', { audioWorks = true } = {}) {
  function element(attributes = '') {
    const classes = new Set();
    return {
      disabled: /\bdisabled\b/.test(attributes), hidden: /\bhidden\b/.test(attributes),
      textContent: '', innerHTML: '', value: '', dataset: {}, scrollLeft: 0,
      handlers: {}, attributes: {}, style: { setProperty() {} },
      classList: {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      contains() { return false; }, focus() {}, replaceChildren() {},
      showModal() {}, close() {},
    };
  }
  const nodes = new Map([...html.matchAll(/<\w+\b([^>]*\bid="([^"]+)"[^>]*)>/g)]
    .map(([, attributes, id]) => [`#${id}`, element(attributes)]));
  for (const name of ['.app-shell', '.board-heading']) nodes.set(name, element());
  const views = ['detail', 'overview'].map(boardView => Object.assign(element(), { dataset: { boardView } }));
  const document = {
    activeElement: null,
    querySelector: selector => nodes.get(selector) ?? null,
    querySelectorAll: selector => selector === '[data-board-view]' ? views : [],
    addEventListener() {},
  };
  const waits = [], played = [], saved = [];
  let currentExercise;
  runInNewContext(controller, {
    document, window: { addEventListener() {} },
    noteName, midiFor, LEVELS, RANGES, DIFFICULTIES, gradeAnswer, matchingPositions,
    makeExercise: options => (currentExercise = makeExercise({ ...options, rng: () => 0.3 })),
    loadPreferences: () => ({ level, difficulty: 'normal', boardView: 'overview', volume: 0.45, speed: 1 }),
    savePreferences: preferences => { saved.push({ ...preferences }); return true; },
    GuitarAudio: class {
      stop() {}
      async play(midi) { played.push(midi); return typeof audioWorks === 'function' ? audioWorks() : audioWorks; }
    },
    runSequence: options => runSequence({ ...options, wait: () => new Promise(resolve => waits.push(resolve)) }),
  });
  const get = id => nodes.get(`#${id}`);
  async function click(id, target) {
    const node = get(id);
    assert.ok(!node.disabled && !node.hidden, `${id} must be actionable`);
    node.handlers.click({ target });
    await flush();
  }
  return {
    get, click, played, saved,
    get exercise() { return currentExercise; },
    get target() { return currentExercise.target; },
    async changeDifficulty(value) { get('difficulty-select').value = value; get('difficulty-select').handlers.change(); await flush(); },
    async enter(position) {
      await click('fretboard', { closest: () => ({ dataset: { position: position.id }, disabled: false }) });
    },
    async changeView() { views[0].handlers.click(); await flush(); },
    async advancePlayback() { waits.shift()?.(); await flush(); },
    async finishPlayback() { while (waits.length) { waits.shift()(); await flush(); } },
  };
}

function answerVerdicts(app) {
  return [...app.get('answer-slots').innerHTML.matchAll(/<button\b[^>]*\bdata-slot="\d+"[^>]*>[\s\S]*?<\/button>/g)]
    .map(([slot]) => {
      const symbol = slot.match(/<span\b[^>]*\bclass="[^"]*\bslot-verdict\b[^"]*"[^>]*>([○×])<\/span>/)?.[1] ?? null;
      const label = slot.match(/\baria-label="([^"]*)"/)?.[1] ?? '';
      if (symbol) assert.ok(label.includes(`、${symbol === '○' ? '正解' : '不正解'}`), 'visible and accessible verdicts must agree');
      else assert.doesNotMatch(label, /、(?:不正解|正解)(?:、|$)/, 'an ungraded answer must not announce an old verdict');
      return symbol;
    });
}

for (const level of ['single', 'pair', 'triple', 'phrase']) {
  test(`${level}: a complete answer can be checked without a completed prompt playback`, async () => {
    const app = screen(level);
    const counts = ['clean-count', 'completed-count'].map(id => app.get(id).textContent);
    assert.equal(app.get('check').disabled, true);
    for (const position of app.target) await app.enter(position);
    assert.equal(app.get('feedback').hidden, true);
    assert.deepEqual(answerVerdicts(app), app.target.map(() => null));
    assert.deepEqual(['clean-count', 'completed-count'].map(id => app.get(id).textContent), counts);
    await app.click('check');
    assert.equal(app.get('feedback-title').textContent, '正解');
    assert.equal(app.get('feedback-mark').hidden, false);
    assert.deepEqual(answerVerdicts(app), app.target.map(() => '○'));
    assert.equal(app.get('clean-count').textContent, 1);
    assert.equal(app.get('next').hidden, false);
  });
}

test('partial answers can be compared before listening, preserving gaps and scores', async () => {
  const app = screen();
  assert.equal(app.get('compare').disabled, true);
  await app.enter(app.target[0]);
  assert.equal(app.get('check').disabled, true);
  const slots = app.get('answer-slots').innerHTML;
  app.played.length = 0;
  await app.click('compare');
  await app.finishPlayback();
  assert.deepEqual(app.played, [...app.target.map(p => p.midi), app.target[0].midi]);
  assert.equal(app.get('answer-slots').innerHTML, slots);
  assert.equal(app.get('next').hidden, true);
  assert.equal(app.get('compare').attributes['aria-busy'], undefined);
  assert.equal(app.get('check').disabled, true);
});

test('interrupting a prompt with input and a view change never locks comparison or grading', async () => {
  const app = screen();
  await app.click('listen');
  assert.equal(app.get('playback-status').textContent, 'お題 1/4');
  await app.enter(app.target[0]);
  await app.changeView();
  for (const position of app.target.slice(1)) await app.enter(position);
  await app.finishPlayback();
  const slots = app.get('answer-slots').innerHTML;
  app.played.length = 0;
  await app.click('compare');
  await app.finishPlayback();
  assert.deepEqual(app.played, [...app.target, ...app.target].map(p => p.midi));
  assert.equal(app.get('answer-slots').innerHTML, slots);
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
  assert.equal(app.get('completed-count').textContent, 1);
  assert.equal(app.get('clean-count').textContent, 1);
});

test('grading during comparison cancels playback without overwriting the result', async () => {
  const app = screen();
  for (const position of app.target) await app.enter(position);
  await app.click('compare');
  assert.equal(app.get('playback-status').textContent, 'お題 1/4');
  await app.click('check');
  await app.finishPlayback();
  assert.equal(app.get('feedback-title').textContent, '正解');
  assert.equal(app.get('completed-count').textContent, 1);
  assert.equal(app.get('compare').attributes['aria-busy'], undefined);
  assert.equal(app.get('next').hidden, false);
});

test('single-note fret taps and playback never grade, even when an audition happens to match', async () => {
  const app = screen('single');
  const counts = ['clean-count', 'completed-count'].map(id => app.get(id).textContent);
  function assertUngraded() {
    assert.equal(app.get('feedback').hidden, true);
    assert.equal(app.get('feedback-mark').hidden, true);
    assert.deepEqual(answerVerdicts(app), [null]);
    assert.equal(app.get('check').disabled, false);
    assert.equal(app.get('check').hidden, false);
    assert.equal(app.get('next').hidden, true);
    assert.deepEqual(['clean-count', 'completed-count'].map(id => app.get(id).textContent), counts);
  }
  await app.click('listen');
  await app.finishPlayback();
  const distinctPitches = new Map(app.exercise.positions.map(position => [position.midi, position]));
  for (const position of distinctPitches.values()) {
    await app.enter(position);
    assertUngraded();
  }
  // Finding the target must not end the question or freeze the answer.
  await app.enter(app.target[0]);
  const other = app.exercise.positions.find(position => position.midi !== app.target[0].midi);
  await app.enter(other);
  assert.match(app.get('answer-slots').innerHTML, new RegExp(`、${other.string}弦 ${other.fret === 0 ? '開放' : `${other.fret}F`}を編集`));
  assertUngraded();
  await app.enter(app.target[0]);
  for (const control of ['listen', 'replay-answer', 'compare']) {
    await app.click(control);
    await app.finishPlayback();
    assertUngraded();
  }
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
  assert.deepEqual(answerVerdicts(app), ['○']);
  assert.equal(app.get('clean-count').textContent, 1);
  assert.equal(app.get('completed-count').textContent, 1);
  assert.equal(app.get('next').hidden, false);
  app.get('check').handlers.click(); // A duplicate submitted event cannot count twice.
  await flush();
  assert.equal(app.get('clean-count').textContent, 1);
  assert.equal(app.get('completed-count').textContent, 1);
});

test('correcting a checked single note needs another explicit check and retains the unsuccessful attempt', async () => {
  const app = screen('single');
  await app.click('listen');
  await app.finishPlayback();
  const wrong = app.exercise.positions.find(position => position.midi !== app.target[0].midi);
  await app.enter(wrong);
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '不正解');
  assert.deepEqual(answerVerdicts(app), ['×']);
  const counts = ['clean-count', 'completed-count'].map(id => app.get(id).textContent);
  await app.enter(app.target[0]);
  await app.click('compare');
  await app.finishPlayback();
  assert.equal(app.get('feedback').hidden, true);
  assert.deepEqual(answerVerdicts(app), [null]);
  assert.equal(app.get('check').disabled, false);
  assert.equal(app.get('next').hidden, true);
  assert.deepEqual(['clean-count', 'completed-count'].map(id => app.get(id).textContent), counts);
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
  assert.deepEqual(answerVerdicts(app), ['○']);
  assert.equal(app.get('completed-count').textContent, 1);
  assert.equal(app.get('clean-count').textContent, 0, 'editing must not erase the unsuccessful explicit attempt');
});

test('an audio failure does not prevent checking an entered answer or revealing it', async () => {
  const app = screen('single', { audioWorks: false });
  await app.click('listen');
  await app.enter(app.target[0]);
  assert.equal(app.get('feedback-title').textContent, '音を再生できません');
  assert.equal(app.get('feedback-mark').hidden, true, 'audio errors must not be shown as incorrect answers');
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
  const unanswered = screen();
  await unanswered.click('reveal');
  assert.equal(unanswered.get('answer-key').hidden, false);
  assert.equal(unanswered.get('next').hidden, false);
});

test('undo disables grading until the removed answer is entered again', async () => {
  const app = screen();
  for (const position of app.target) await app.enter(position);
  await app.click('clear-answer');
  assert.equal(app.get('check').disabled, true);
  assert.equal(app.get('compare').disabled, false);
  await app.enter(app.target.at(-1));
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
});

test('editing a graded answer clears stale feedback and only its verdict; undo restores the verdicts', async () => {
  const app = screen();
  await app.enter(app.target[1]); // The first answer is wrong; the other three are correct.
  for (const position of app.target.slice(1)) await app.enter(position);
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '不正解');
  assert.equal(app.get('feedback-mark').hidden, false);
  assert.deepEqual(answerVerdicts(app), ['×', '○', '○', '○']);

  await app.click('replay-answer');
  await app.finishPlayback();
  assert.equal(app.get('feedback-title').textContent, '不正解');
  assert.deepEqual(answerVerdicts(app), ['×', '○', '○', '○']);

  await app.enter(app.target[0]);
  assert.equal(app.get('feedback').hidden, true);
  assert.equal(app.get('feedback-mark').hidden, true);
  assert.deepEqual(answerVerdicts(app), [null, '○', '○', '○']);

  await app.click('clear-answer');
  assert.deepEqual(answerVerdicts(app), ['×', '○', '○', '○']);
  await app.enter(app.target[0]);
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
  assert.deepEqual(answerVerdicts(app), ['○', '○', '○', '○']);
  assert.equal(app.get('clean-count').textContent, 0, 'undo must not erase the unsuccessful attempt');
});

test('revealing the answer and starting another question clear previous answer verdicts', async () => {
  const app = screen('triple');
  await app.enter(app.target[1]);
  for (const position of app.target.slice(1)) await app.enter(position);
  await app.click('check');
  assert.deepEqual(answerVerdicts(app), ['×', '○', '○']);

  await app.click('reveal');
  assert.deepEqual(answerVerdicts(app), [null, null, null]);
  assert.equal(app.get('feedback-mark').hidden, true, 'revealing an answer is not a successful attempt');
  assert.equal(app.get('answer-key').hidden, false);

  await app.click('next');
  await app.finishPlayback();
  assert.deepEqual(answerVerdicts(app), [null, null, null]);
  assert.equal(app.get('feedback').hidden, true);
  assert.equal(app.get('feedback-mark').hidden, true);
  assert.equal(app.get('answer-key').hidden, true);
});

test('successful answer playback clears a transient audio error only after a real note, preserving an ungraded draft', async () => {
  let audioAvailable = true;
  const app = screen('triple', { audioWorks: () => audioAvailable });
  await app.click('answer-slots', { closest: () => ({ dataset: { slot: '1' } }) });
  await app.enter(app.target[1]);
  const slots = app.get('answer-slots').innerHTML;
  const counts = ['clean-count', 'completed-count'].map(id => app.get(id).textContent);
  audioAvailable = false;
  await app.click('replay-answer');
  await app.finishPlayback();
  assert.equal(app.get('feedback-title').textContent, '音を再生できません');

  audioAvailable = true;
  await app.click('replay-answer');
  assert.equal(app.get('playback-status').textContent, '回答 1/3 · 空き');
  assert.equal(app.get('feedback-title').textContent, '音を再生できません', 'an empty slot does not prove audio recovered');
  await app.advancePlayback();
  assert.equal(app.get('playback-status').textContent, '回答 2/3');
  assert.equal(app.get('feedback').hidden, true);
  await app.finishPlayback();
  assert.equal(app.get('answer-slots').innerHTML, slots);
  assert.deepEqual(['clean-count', 'completed-count'].map(id => app.get(id).textContent), counts);
});

for (const outcome of ['correct', 'wrong', 'revealed']) {
  test(`successful comparison restores ${outcome} feedback after an audio failure without changing the result`, async () => {
    let audioAvailable = true;
    const app = screen('triple', { audioWorks: () => audioAvailable });
    await app.enter(outcome === 'wrong' ? app.target[1] : app.target[0]);
    for (const position of app.target.slice(1)) await app.enter(position);
    await app.click(outcome === 'revealed' ? 'reveal' : 'check');
    const title = app.get('feedback-title').textContent;
    const detail = app.get('feedback-detail').textContent;
    const slots = app.get('answer-slots').innerHTML;
    const counts = ['clean-count', 'completed-count'].map(id => app.get(id).textContent);
    const answerHidden = app.get('answer-key').hidden;
    audioAvailable = false;
    await app.click('compare');
    assert.equal(app.get('feedback-title').textContent, '音を再生できません');

    audioAvailable = true;
    await app.click('compare');
    assert.equal(app.get('playback-status').textContent, 'お題 1/3');
    assert.equal(app.get('feedback-title').textContent, title);
    assert.equal(app.get('feedback-detail').textContent, detail);
    assert.equal(app.get('feedback-mark').hidden, outcome === 'revealed');
    await app.finishPlayback();
    assert.equal(app.get('answer-slots').innerHTML, slots);
    assert.deepEqual(['clean-count', 'completed-count'].map(id => app.get(id).textContent), counts);
    assert.equal(app.get('answer-key').hidden, answerHidden);
  });
}

test('a successful fret audition restores the settled result after an audio failure', async () => {
  let audioAvailable = true;
  const app = screen('single', { audioWorks: () => audioAvailable });
  await app.enter(app.target[0]);
  await app.click('check');
  const slots = app.get('answer-slots').innerHTML;
  audioAvailable = false;
  await app.enter(app.target[0]);
  assert.equal(app.get('feedback-title').textContent, '音を再生できません');
  audioAvailable = true;
  await app.enter(app.target[0]);
  assert.equal(app.get('feedback-title').textContent, '正解');
  assert.equal(app.get('answer-slots').innerHTML, slots);
  assert.equal(app.get('clean-count').textContent, 1);
  assert.equal(app.get('completed-count').textContent, 1);
});

test('a cancelled pending audio success does not clear the current error', async () => {
  let audioResult = false;
  const app = screen('triple', { audioWorks: () => audioResult });
  await app.enter(app.target[0]);
  let resolveAudio;
  audioResult = new Promise(resolve => { resolveAudio = resolve; });
  await app.click('replay-answer');
  await app.changeView();
  resolveAudio(true);
  await flush();
  assert.equal(app.get('feedback-title').textContent, '音を再生できません');
  assert.equal(app.get('playback-status').textContent, '');
});

test('difficulty changes the audible span, cancels playback and preserves the fretboard, note count, view and scores', async () => {
  const app = screen('triple');
  assert.equal(app.get('difficulty-select').value, 'normal');
  const boardPositions = app.exercise.positions;
  await app.enter(app.target[0]);
  await app.click('compare');
  for (const [difficulty, minSpan, maxSpan] of [['hard', 17, 28], ['easy', 1, 9], ['normal', 10, 16]]) {
    const completed = app.get('completed-count').textContent;
    await app.changeDifficulty(difficulty);
    assert.equal(app.exercise.difficulty, difficulty);
    assert.equal(app.exercise.range, 'extended');
    assert.equal(app.exercise.level, 'triple');
    assert.equal(app.target.length, 3);
    assert.deepEqual(app.exercise.positions, boardPositions);
    assert.equal(app.get('fretboard').dataset.maxFret, 22);
    const targetMidis = app.target.map(p => p.midi);
    const span = Math.max(...targetMidis) - Math.min(...targetMidis);
    assert.ok(span >= minSpan && span <= maxSpan, `${difficulty} question spans ${span} semitones`);
    assert.equal(app.get('completed-count').textContent, completed);
    assert.equal(app.get('playback-status').textContent, '');
    assert.equal(app.get('check').disabled, true);
    assert.equal(app.get('compare').disabled, true);
    assert.deepEqual(answerVerdicts(app), [null, null, null]);
    assert.equal(app.saved.at(-1).difficulty, difficulty);
    assert.equal(app.saved.at(-1).boardView, 'overview');
    assert.equal(app.saved.at(-1).level, 'triple');
    const playedBefore = app.played.length;
    await app.finishPlayback();
    assert.equal(app.played.length, playedBefore, 'cancelled playback cannot sound after a change');
  }
  for (const position of app.target) await app.enter(position);
  await app.click('check');
  assert.equal(app.get('feedback-title').textContent, '正解');
});

test('the audio player receives the full question span for every multi-note difficulty', async () => {
  for (const level of ['pair', 'triple', 'phrase']) {
    const app = screen(level);
    for (const [difficulty, minSpan, maxSpan] of [['easy', 1, 9], ['normal', 10, 16], ['hard', 17, 28]]) {
      await app.changeDifficulty(difficulty);
      app.played.length = 0;
      await app.click('listen');
      await app.finishPlayback();
      assert.deepEqual(app.played, app.target.map(p => p.midi), 'playback must not fold target pitches into one octave');
      const span = Math.max(...app.played) - Math.min(...app.played);
      assert.ok(span >= minSpan && span <= maxSpan, `${level}/${difficulty} actually plays ${span} semitones`);
      assert.equal(app.get('fretboard').dataset.maxFret, 22);
    }
  }
});
