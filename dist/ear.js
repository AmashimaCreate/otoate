import { noteName, midiFor } from './engine.js';
import { GuitarAudio } from './audio.js';
import { LEVELS, RANGES, makeExercise, gradeAnswer, matchingPositions } from './ear-model.js';
import { runSequence } from './ear-playback.js';
import { loadPreferences, savePreferences } from './ear-preferences.js';

const $ = selector => document.querySelector(selector);
const guitar = new GuitarAudio();
const pitch = p => `${noteName(p.pc)}${Math.floor(p.midi / 12) - 1}`;
const location = p => `${p.string}弦 ${p.fret === 0 ? '開放' : `${p.fret}F`}`;
const preferences = loadPreferences();
let { level, range, boardView } = preferences;
let exercise, draft = [], cursor = 0, edits = [];
let heard = false, attempts = 0, settled = false, results = null;
let focusId = '1-0', completed = 0, clean = 0;
let generation = 0;
let detailScroll = 0;
let normalFeedback = [], audioFailed = false;
const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21];

function clearStep() {
  document.querySelectorAll('.is-sounding, #prompt-beats .is-current').forEach(node => node.classList.remove('is-sounding', 'is-current'));
}

function clearPlaybackUI() {
  clearStep();
  for (const id of ['listen', 'compare', 'replay-answer']) {
    $(`#${id}`).classList.remove('is-playing');
    $(`#${id}`).removeAttribute('aria-busy');
  }
  $('.board-heading').classList.remove('is-playing');
  $('#playback-status').textContent = '';
  $('#listen-label').textContent = heard ? 'もう一度聴く' : 'お題を聴く';
}

function persistPreferences() {
  Object.assign(preferences, { level, range, boardView, volume: Number($('#volume').value), speed: Number($('#speed-select').value) });
  const saved = savePreferences(preferences);
  $('#settings-storage').textContent = saved ? '' : '設定を保存できません';
  $('#settings-storage').hidden = saved;
}

function stop() {
  generation++;
  guitar.stop();
  clearPlaybackUI();
}

function message(title = '', detail = '', kind = '') {
  if (kind !== 'error') normalFeedback = [title, detail, kind];
  audioFailed = kind === 'error';
  $('#feedback-title').textContent = title;
  $('#feedback-detail').textContent = detail;
  $('#feedback-title').hidden = !title;
  $('#feedback-detail').hidden = !detail;
  $('#feedback').hidden = !title && !detail;
  $('#feedback').className = `feedback ${kind ? `is-${kind}` : ''}`;
  $('#feedback-mark').textContent = kind === 'correct' ? '○' : kind === 'wrong' ? '×' : '';
  $('#feedback-mark').hidden = kind !== 'correct' && kind !== 'wrong';
}

function audioError() {
  message('音を再生できません', '', 'error');
}

function audioRecovered() {
  if (audioFailed) message(...normalFeedback);
}

async function startPlayback(segments, { answerIndex = null } = {}) {
  stop();
  const token = generation;
  const current = exercise;
  const isPrompt = segments.length === 1 && segments[0].kind === 'prompt';
  const control = segments.length > 1 ? $('#compare') : isPrompt ? $('#listen') : $('#replay-answer');
  control.classList.add('is-playing');
  control.setAttribute('aria-busy', 'true');
  if (isPrompt || segments.length > 1) {
    $('#listen-label').textContent = '再生中…';
  }
  const result = await runSequence({
    segments, guitar,
    volume: Number($('#volume').value),
    intervalMs: 650 / Number($('#speed-select').value),
    isCurrent: () => token === generation && current === exercise,
    onStep: ({ kind, index, total, position }) => {
      if (position) audioRecovered();
      const shownIndex = kind === 'answer' && answerIndex !== null ? answerIndex : index;
      const shownTotal = kind === 'answer' && answerIndex !== null ? draft.length : total;
      clearStep();
      $('.board-heading').classList.add('is-playing');
      $('#playback-status').textContent = `${kind === 'prompt' ? 'お題' : '回答'} ${shownIndex + 1}/${shownTotal}${position ? '' : ' · 空き'}`;
      if (kind === 'prompt') {
        $(`#prompt-beats [data-beat="${index}"]`)?.classList.add('is-current');
        if (!heard) { heard = true; renderControls(); }
      } else {
        $(`[data-slot="${shownIndex}"]`)?.classList.add('is-sounding');
        if (position) $(`[data-position="${position.id}"]`)?.classList.add('is-sounding');
      }
    },
  });
  if (token !== generation || current !== exercise) return;
  clearPlaybackUI();
  if (result.status === 'error') { stop(); audioError(); return; }
  if (result.status !== 'complete') return;
  if (isPrompt && !settled && !results) message();
  renderControls();
}

function playNotes(notes, isPrompt = false) {
  return startPlayback([{ kind: isPrompt ? 'prompt' : 'answer', notes, beats: exercise.beats }]);
}

function newExercise({ play = false } = {}) {
  const previous = exercise?.target || [];
  stop();
  exercise = makeExercise({ level, range, previous });
  exercise.beats = Array(exercise.target.length).fill(1);
  draft = Array(exercise.target.length).fill(null);
  cursor = 0; heard = false; attempts = 0; settled = false; results = null; edits = [];
  $('#listen-label').textContent = 'お題を聴く';
  focusId = exercise.positions[0].id;
  $('#question-label').textContent = `お題 ${String(completed + 1).padStart(2, '0')}`;
  $('#prompt-beats').innerHTML = Array.from({ length: draft.length }, (_, i) => `<span data-beat="${i}"></span>`).join('');
  $('#range-select').value = range;
  $('#touched-note').textContent = '';
  $('#answer-key').hidden = true;
  $('#answer-key').replaceChildren();
  message();
  renderSlots(); renderBoard(); renderControls();
  renderRangeNote();
  if (play) playNotes(exercise.target, true);
}

function renderControls() {
  const filled = draft.some(Boolean);
  // Input readiness is independent of playback, which any edit can interrupt.
  $('#check').disabled = settled || !draft.every(Boolean);
  $('#check').hidden = settled;
  $('#next').hidden = !settled;
  $('#next').innerHTML = '次へ <span>→</span>';
  $('#reveal').disabled = settled;
  $('#reveal').hidden = settled;
  $('#replay-answer').disabled = !filled;
  $('#clear-answer').disabled = !edits.length || settled;
  $('#compare').disabled = !filled;
  $('#action-hint').textContent = settled ? '緑の位置が正解' : draft.length === 1 ? 'タップで判定' : '入力すると次の枠へ。枠を選んで1音ずつ直すこともできます。';
  $('#board-instruction').textContent = settled || draft.length === 1 ? '' : `入力 ${cursor + 1}/${draft.length}`;
}

function renderSlots() {
  const focused = $('#answer-slots').contains(document.activeElement) ? document.activeElement.dataset.slot : null;
  $('#answer-slots').style.setProperty('--answer-count', draft.length);
  $('#answer-slots').innerHTML = draft.map((p, i) => {
    const match = results?.matches[i];
    const verdict = match === true ? 'is-match' : match === false ? 'is-miss' : '';
    const badge = verdict ? `<span class="slot-verdict ${verdict}" aria-hidden="true">${match ? '○' : '×'}</span>` : '';
    return `<button type="button" class="answer-slot ${cursor === i && !settled ? 'is-active' : ''} ${p ? 'is-filled' : ''} ${verdict}" data-slot="${i}" aria-pressed="${cursor === i && !settled}" aria-label="${i + 1}音目${p ? `、${pitch(p)}、${location(p)}` : '、未入力'}${settled ? 'を聴く' : 'を編集'}${match === true ? '、正解' : match === false ? '、不正解' : ''}"><span class="slot-header"><span class="slot-index">0${i + 1}</span>${badge}</span><strong>${p ? pitch(p) : '−'}</strong><small>${p ? location(p) : 'タップで選ぶ'}</small></button>`;
  }).join('');
  if (focused !== null) $(`[data-slot="${focused}"]`)?.focus({ preventScroll: true });
}

function renderBoard() {
  const selection = RANGES.find(item => item.id === range);
  const max = selection.maxFret;
  const allowed = new Set(exercise.positions.map(p => p.id));
  const answers = settled ? exercise.target : [];
  const board = $('#fretboard');
  const hadFocus = board.contains(document.activeElement);
  const scroll = $('#board-scroll').scrollLeft;
  const overview = boardView === 'overview';
  // Fret distances shorten up the neck; CSS keeps a minimum hit area on the
  // detailed board. The overview uses equal tracks to keep the entire neck visible.
  board.style.setProperty('--fret-tracks', Array.from({ length: max }, (_, index) =>
    `minmax(var(--fret-min, 0px), ${Math.pow(2, -index / 12).toFixed(4)}fr)`).join(' '));
  board.style.setProperty('--max-fret', max);
  board.dataset.maxFret = max;
  board.style.setProperty('--detail-min-width', `${100 + max * 50}px`);
  board.classList.toggle('is-wide', max > 5);
  board.classList.toggle('is-overview', overview);
  board.classList.toggle('is-single-string', range === 'first');
  board.classList.toggle('is-settled', settled);
  $('.app-shell').classList.toggle('has-overview', overview);
  document.querySelectorAll('[data-board-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.boardView === boardView)));
  board.setAttribute('aria-label', `ギター指板。${range === 'first' ? '1弦のみ' : '上から1弦、下が6弦'}。左から開放弦と1〜${max}フレット。`);
  const labels = `<div class="fret-labels" aria-hidden="true"><span></span>${Array.from({ length: max + 1 }, (_, fret) => `<span data-fret="${fret}" class="${INLAY_FRETS.includes(fret) ? 'inlay' : ''}">${!overview || max <= 5 || fret === 0 || INLAY_FRETS.includes(fret) ? fret : ''}</span>`).join('')}</div>`;
  board.innerHTML = labels + Array.from({ length: 6 }, (_, index) => {
    const string = index + 1;
    const open = midiFor(string, 0);
    const enabled = selection.strings.includes(string);
    const active = draft[cursor]?.string === string;
    const gauge = [1, 1.3, 1.7, 2.4, 3, 3.8][index];
    return `<div class="fret-row ${active ? 'is-active' : ''} ${enabled ? '' : 'is-disabled'}" data-string="${string}" data-enabled="${enabled}" style="--string-width:${gauge}px"><span class="string-name">${string}<span>${noteName(open % 12)}</span></span>${Array.from({ length: max + 1 }, (_, fret) => {
      const id = `${string}-${fret}`;
      const midi = midiFor(string, fret);
      const selected = draft.map((p, i) => p?.id === id ? i + 1 : null).filter(Boolean);
      const enabled = allowed.has(id);
      const correct = answers.map((p, i) => enabled && p.midi === midi ? i + 1 : null).filter(Boolean);
      const markedSlots = correct.length ? correct : selected;
      const marker = overview ? '' : markedSlots.length > 2 ? markedSlots.map(index => `<span>${index}</span>`).join('') : markedSlots.join('·');
      const inlay = (INLAY_FRETS.includes(fret) && fret !== 12 && string === (range === 'first' ? 1 : 3)) || (fret === 12 && [2, 4].includes(string));
      return `<button type="button" class="fret-cell ${fret === 0 ? 'open' : ''} ${selected.length ? 'is-picked' : ''} ${correct.length ? 'is-solution' : ''}" data-position="${id}" tabindex="${enabled && id === focusId ? '0' : '-1'}" ${enabled ? '' : 'disabled'} aria-label="${string}弦${fret === 0 ? '開放弦' : `${fret}フレット`}${correct.length ? `、${correct.join('・')}音目の正解` : ''}">${inlay ? '<span class="inlay-marker" aria-hidden="true"></span>' : ''}<span class="fret-dot ${!overview && markedSlots.length > 2 ? 'has-many' : ''}" aria-hidden="true">${marker}</span></button>`;
    }).join('')}</div>`;
  }).join('');
  $('#board-scroll').scrollLeft = overview ? 0 : scroll;
  if (hadFocus) $(`[data-position="${focusId}"]`)?.focus({ preventScroll: true });
}

function setBoardView(view) {
  if (!['detail', 'overview'].includes(view) || view === boardView) return;
  stop();
  const scroller = $('#board-scroll');
  if (boardView === 'detail') detailScroll = scroller.scrollLeft;
  boardView = view;
  renderBoard();
  if (view === 'detail') scroller.scrollLeft = detailScroll;
  persistPreferences();
}

function renderRangeNote() {
  const selection = RANGES.find(item => item.id === range);
  $('#range-note').textContent = selection.label;
}

async function selectPosition(id) {
  const p = exercise.positions.find(item => item.id === id);
  if (!p) return;
  stop();
  const token = generation;
  const current = exercise;
  focusId = id;
  if (!settled) {
    if (draft[cursor]?.id !== p.id) {
      edits.push({ draft: [...draft], cursor, results: results ? { ...results, matches: [...results.matches] } : null });
      if (edits.length > 100) edits.shift();
      if (results) results = { ...results, matches: results.matches.map((match, index) => index === cursor ? null : match) };
      message();
    }
    draft[cursor] = p;
    cursor = (cursor + 1) % draft.length;
  }
  $('#touched-note').textContent = `${location(p)} / ${pitch(p)}`;
  renderSlots(); renderBoard(); renderControls();
  const ok = await guitar.play(p.midi, { volume: Number($('#volume').value) });
  if (token !== generation || current !== exercise) return;
  if (!ok) audioError();
  else {
    audioRecovered();
    if (heard && !settled && draft.length === 1) checkAnswer({ stopAudio: false });
  }
}

function finish(showedAnswer) {
  if (settled) return;
  settled = true;
  completed++;
  if (!showedAnswer && attempts === 1) clean++;
  $('#completed-count').textContent = completed;
  $('#clean-count').textContent = clean;
  $('#answer-key').hidden = !showedAnswer;
  $('#answer-key').innerHTML = `<div class="key-notes">${exercise.target.map(p => {
    const locations = matchingPositions(p.midi, exercise.positions);
    return `<span title="${locations.map(location).join(' / ')}" aria-label="${pitch(p)}、${locations.map(location).join('、')}">${pitch(p)}</span>`;
  }).join('')}</div>`;
  renderSlots(); renderBoard(); renderControls();
  $('#next').focus({ preventScroll: true });
}

function checkAnswer({ stopAudio = true } = {}) {
  if (settled || !draft.every(Boolean)) return;
  if (stopAudio) stop();
  results = gradeAnswer(exercise.target, draft);
  attempts++;
  if (results.correct) {
    message('正解', '', 'correct');
    finish(false);
  } else {
    const count = results.matches.filter(Boolean).length;
    const wrongIndex = results.matches.findIndex(item => !item);
    cursor = wrongIndex;
    const octave = draft[wrongIndex]?.pc === exercise.target[wrongIndex].pc;
    const detail = [draft.length > 1 ? `${count} / ${draft.length}音 正解` : '', octave ? 'オクターブ違い' : ''].filter(Boolean).join(' · ');
    message('不正解', detail, 'wrong');
    renderSlots(); renderControls();
  }
}

$('#listen').addEventListener('click', () => playNotes(exercise.target, true));
$('#replay-answer').addEventListener('click', () => { if (draft.some(Boolean)) playNotes(draft); });
$('#compare').addEventListener('click', () => {
  if (!draft.some(Boolean)) return;
  startPlayback([{ kind: 'prompt', notes: exercise.target, beats: exercise.beats }, { kind: 'answer', notes: draft, beats: exercise.beats }]);
});
$('#check').addEventListener('click', () => checkAnswer());
$('#reveal').addEventListener('click', () => {
  if (settled) return;
  stop();
  results = null;
  message('正解の音');
  finish(true);
});
$('#next').addEventListener('click', () => newExercise({ play: true }));
function undoAnswer() {
  if (settled || !edits.length) return;
  stop();
  const previous = edits.pop();
  draft = previous.draft; cursor = previous.cursor; results = previous.results;
  const p = draft[cursor] || draft.findLast(Boolean);
  $('#touched-note').textContent = p ? `${location(p)} / ${pitch(p)}` : '';
  message();
  renderSlots(); renderBoard(); renderControls();
}
$('#clear-answer').addEventListener('click', undoAnswer);
$('#answer-slots').addEventListener('click', event => {
  const slot = event.target.closest('[data-slot]');
  if (!slot) return;
  const index = Number(slot.dataset.slot);
  stop();
  if (!settled) cursor = index;
  renderSlots(); renderControls();
  if (draft[index]) startPlayback([{ kind: 'answer', notes: [draft[index]] }], { answerIndex: index });
});
$('#fretboard').addEventListener('click', event => {
  const button = event.target.closest('[data-position]');
  if (!button || button.disabled) return;
  selectPosition(button.dataset.position);
});
document.querySelectorAll('[data-board-view]').forEach(button => button.addEventListener('click', () => setBoardView(button.dataset.boardView)));
$('#fretboard').addEventListener('keydown', event => {
  const button = event.target.closest('[data-position]');
  const modified = event.ctrlKey || event.metaKey || event.altKey;
  if (button && !modified && event.key === ' ') { event.preventDefault(); if (!event.repeat) playNotes(exercise.target, true); return; }
  if (button && !modified && event.key === 'Backspace') { event.preventDefault(); if (!event.repeat) undoAnswer(); return; }
  if (!button || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  let [string, fret] = button.dataset.position.split('-').map(Number);
  if (event.key === 'ArrowLeft') fret--;
  if (event.key === 'ArrowRight') fret++;
  if (event.key === 'ArrowUp') string--;
  if (event.key === 'ArrowDown') string++;
  const next = $(`[data-position="${string}-${fret}"]`);
  if (!next || next.disabled) return;
  button.tabIndex = -1; next.tabIndex = 0; focusId = next.dataset.position;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
document.querySelectorAll('[data-level]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.level === level || !LEVELS.some(item => item.id === button.dataset.level)) return;
  level = button.dataset.level;
  document.querySelectorAll('[data-level]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  newExercise();
  persistPreferences();
}));
$('#range-select').addEventListener('change', () => {
  const selected = $('#range-select').value;
  if (!RANGES.some(item => item.id === selected)) return;
  range = selected;
  newExercise();
  persistPreferences();
});
$('#settings-open').addEventListener('click', () => { stop(); $('#settings-dialog').showModal(); });
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
$('#settings-dialog').addEventListener('click', event => {
  if (event.target !== event.currentTarget) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
});
$('#volume').addEventListener('input', () => { stop(); persistPreferences(); });
$('#speed-select').addEventListener('change', () => { stop(); persistPreferences(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', stop);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('dialog[open]')) stop();
  if (event.key !== ' ' || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || $('dialog[open]') || event.target.closest('button,a,input,select,textarea')) return;
  event.preventDefault(); playNotes(exercise.target, true);
});
$('#volume').value = preferences.volume;
$('#speed-select').value = preferences.speed;
document.querySelectorAll('[data-level]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.level === level)));
newExercise();
