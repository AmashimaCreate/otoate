import test from 'node:test';
import assert from 'node:assert/strict';
import { runSequence } from '../dist/ear-playback.js';

const note = midi => ({ id: `note-${midi}`, midi, string: 1, fret: midi - 64 });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const phrase = (...midis) => [{ kind: 'prompt', notes: midis.map(note) }];

test('plays prompt then answer with defaults, a comparison gap, and a ringing final note', async () => {
  const events = [];
  const result = await runSequence({
    segments: [...phrase(64, 66), { kind: 'answer', notes: [note(64), note(67)] }],
    guitar: {
      play: async (midi, options) => { events.push(['play', midi, options.volume]); return true; },
      stop: () => events.push(['stop']),
    },
    onStep: ({ kind, index, total, position }) => events.push(['step', kind, index, total, position.midi]),
    wait: async ms => { events.push(['wait', ms]); },
  });
  assert.deepEqual(result, { status: 'complete' });
  assert.deepEqual(events, [
    ['play', 64, 0.45], ['step', 'prompt', 0, 2, 64], ['wait', 650],
    ['stop'], ['play', 66, 0.45], ['step', 'prompt', 1, 2, 66], ['wait', 650],
    ['wait', 250],
    ['stop'], ['play', 64, 0.45], ['step', 'answer', 0, 2, 64], ['wait', 650],
    ['stop'], ['play', 67, 0.45], ['step', 'answer', 1, 2, 67], ['wait', 650],
  ]);
});

test('empty answer positions retain their indices and durations without sounding a note', async () => {
  const events = [];
  const result = await runSequence({
    segments: [{ kind: 'answer', notes: [null, note(66), null, note(69)] }],
    volume: 0.2,
    intervalMs: 480,
    guitar: {
      play: async (midi, { volume }) => { events.push(['play', midi, volume]); return true; },
      stop: () => events.push(['stop']),
    },
    onStep: ({ kind, index, total, position }) => events.push(['step', kind, index, total, position?.midi ?? null]),
    wait: async ms => { events.push(['wait', ms]); },
  });
  assert.deepEqual(result, { status: 'complete' });
  assert.deepEqual(events, [
    ['step', 'answer', 0, 4, null], ['wait', 480],
    ['stop'], ['play', 66, 0.2], ['step', 'answer', 1, 4, 66], ['wait', 480],
    ['stop'], ['step', 'answer', 2, 4, null], ['wait', 480],
    ['stop'], ['play', 69, 0.2], ['step', 'answer', 3, 4, 69], ['wait', 480],
  ]);
});

test('snapshots segment order, note slots, and position objects before the first await', async () => {
  const started = deferred();
  const pendingPlay = deferred();
  const segments = [...phrase(64, 66), { kind: 'answer', notes: [note(67), null] }];
  const played = [];
  const steps = [];
  const run = runSequence({
    segments,
    guitar: {
      play: (midi) => {
        played.push(midi);
        if (played.length === 1) { started.resolve(); return pendingPlay.promise; }
        return true;
      },
      stop: () => {},
    },
    onStep: step => steps.push(step),
    wait: async () => {},
  });
  await started.promise;
  segments[0].notes[0].midi = 99;
  segments[0].notes[1].midi = 100;
  segments[0].notes.pop();
  segments[1].kind = 'prompt';
  segments[1].notes[0].midi = 101;
  segments[1].notes[1] = note(102);
  segments.pop();
  pendingPlay.resolve(true);

  assert.deepEqual(await run, { status: 'complete' });
  assert.deepEqual(played, [64, 66, 67]);
  assert.deepEqual(steps.map(({ kind, index, total, position }) => [kind, index, total, position?.midi ?? null]), [
    ['prompt', 0, 2, 64], ['prompt', 1, 2, 66], ['answer', 0, 2, 67], ['answer', 1, 2, null],
  ]);
});

test('an already cancelled run performs no work', async () => {
  const unexpected = () => assert.fail('stale run performed work');
  const result = await runSequence({
    segments: phrase(64),
    guitar: { play: unexpected, stop: unexpected },
    isCurrent: () => false,
    onStep: unexpected,
    wait: unexpected,
  });
  assert.deepEqual(result, { status: 'cancelled' });
});

for (const completion of ['success', 'false', 'throw']) {
  test(`cancellation during pending play takes precedence over ${completion} without touching newer audio`, async () => {
    const pendingPlay = deferred();
    const started = deferred();
    let current = true;
    let stops = 0;
    let steps = 0;
    let waits = 0;
    const run = runSequence({
      segments: phrase(64, 66),
      guitar: {
        play: () => { started.resolve(); return pendingPlay.promise; },
        stop: () => { stops += 1; },
      },
      isCurrent: () => current,
      onStep: () => { steps += 1; },
      wait: async () => { waits += 1; },
    });
    await started.promise;
    current = false;
    if (completion === 'throw') pendingPlay.reject(new Error('audio unavailable'));
    else pendingPlay.resolve(completion === 'success');
    assert.deepEqual(await run, { status: 'cancelled' });
    assert.deepEqual({ stops, steps, waits }, { stops: 0, steps: 0, waits: 0 });
  });
}

for (const stage of ['note', 'gap', 'final']) {
  test(`cancellation during ${stage} wait prevents later sound and completion`, async () => {
    const paused = deferred();
    const pendingWait = deferred();
    let current = true;
    const events = [];
    let waits = 0;
    const pauseAt = { note: 1, gap: 2, final: 3 }[stage];
    const run = runSequence({
      segments: [...phrase(64), { kind: 'answer', notes: [note(66)] }],
      guitar: {
        play: async midi => { events.push(['play', midi]); return true; },
        stop: () => events.push(['stop']),
      },
      isCurrent: () => current,
      onStep: ({ kind }) => events.push(['step', kind]),
      wait: ms => {
        events.push(['wait', ms]);
        waits += 1;
        if (waits === pauseAt) { paused.resolve(); return pendingWait.promise; }
        return Promise.resolve();
      },
    });
    await paused.promise;
    const eventsAtCancellation = structuredClone(events);
    current = false;
    pendingWait.resolve();
    assert.deepEqual(await run, { status: 'cancelled' });
    assert.deepEqual(events, eventsAtCancellation);
    assert.equal(events.filter(event => event[0] === 'play').length, stage === 'final' ? 2 : 1);
  });
}

test('cancellation from a step callback starts no interval or later note', async () => {
  let current = true;
  const result = await runSequence({
    segments: phrase(64, 66),
    guitar: { play: async () => true, stop: () => assert.fail('stop after cancellation') },
    isCurrent: () => current,
    onStep: () => { current = false; },
    wait: () => assert.fail('wait after cancellation'),
  });
  assert.deepEqual(result, { status: 'cancelled' });
});

for (const failure of ['false', 'throw']) {
  test(`play returning ${failure} reports an error before any visual step or wait`, async () => {
    const unexpected = () => assert.fail('work after failed playback');
    const result = await runSequence({
      segments: phrase(64, 66),
      guitar: {
        play: async () => {
          if (failure === 'throw') throw new Error('audio unavailable');
          return false;
        },
        stop: unexpected,
      },
      onStep: unexpected,
      wait: unexpected,
    });
    assert.deepEqual(result, { status: 'error' });
  });
}

test('wait rejection returns an error without stopping a newer sound or progressing', async () => {
  const played = [];
  const result = await runSequence({
    segments: phrase(64, 66),
    guitar: {
      play: async midi => { played.push(midi); return true; },
      stop: () => assert.fail('stop after failed wait'),
    },
    wait: async () => { throw new Error('wait failed'); },
  });
  assert.deepEqual(result, { status: 'error' });
  assert.deepEqual(played, [64]);
});

test('musical beats give prompt and answer the same durations, including empty answer slots', async () => {
  const beats = [0.5, 1, 0.5, 2];
  const waits = [];
  const steps = [];
  const played = [];
  const result = await runSequence({
    segments: [
      { ...phrase(64, 66, 67, 69)[0], beats },
      { kind: 'answer', notes: [note(64), null, note(67), null], beats },
    ],
    intervalMs: 600,
    guitar: {
      play: async midi => { played.push(midi); return true; },
      stop: () => {},
    },
    onStep: ({ kind, index, total, position }) => steps.push([kind, index, total, position?.midi ?? null]),
    wait: async ms => { waits.push(ms); },
  });
  assert.deepEqual(result, { status: 'complete' });
  assert.deepEqual(waits, [300, 600, 300, 1200, 250, 300, 600, 300, 1200]);
  assert.deepEqual(played, [64, 66, 67, 69, 64, 67]);
  assert.deepEqual(steps.slice(4), [
    ['answer', 0, 4, 64], ['answer', 1, 4, null],
    ['answer', 2, 4, 67], ['answer', 3, 4, null],
  ]);
});

test('missing, invalid, and out-of-range beats fall back to one beat without coercion', async () => {
  const beats = [Infinity, -Infinity, NaN, 0, -1, 0.24, 4.01, '2', null, undefined, false, 1, 0.25, 4];
  const waits = [];
  const result = await runSequence({
    segments: [
      { kind: 'answer', notes: Array(beats.length + 1).fill(null), beats },
      { kind: 'answer', notes: [null], beats: '2' },
    ],
    intervalMs: 400,
    guitar: { play: () => assert.fail('empty slot played a note'), stop: () => {} },
    wait: async ms => { waits.push(ms); },
  });
  assert.deepEqual(result, { status: 'complete' });
  assert.deepEqual(waits, [...Array(12).fill(400), 100, 1600, 400, 250, 400]);
});

test('rhythm arrays are snapshotted before pending playback and later UI edits', async () => {
  const pendingPlay = deferred();
  const started = deferred();
  const beats = [0.5, 2];
  const segments = [
    { ...phrase(64, 66)[0], beats },
    { kind: 'answer', notes: [null, note(66)], beats },
  ];
  const waits = [];
  let first = true;
  const run = runSequence({
    segments,
    intervalMs: 500,
    guitar: {
      play: () => {
        if (first) {
          first = false;
          started.resolve();
          return pendingPlay.promise;
        }
        return true;
      },
      stop: () => {},
    },
    wait: async ms => { waits.push(ms); },
  });
  await started.promise;
  beats[0] = 4;
  beats.pop();
  segments[1].beats = [1, 1];
  pendingPlay.resolve(true);

  assert.deepEqual(await run, { status: 'complete' });
  assert.deepEqual(waits, [250, 1000, 250, 250, 1000]);
});

test('cancelling during a long beat never advances or stops the successor sound', async () => {
  const pendingWait = deferred();
  const paused = deferred();
  const events = [];
  let current = true;
  const run = runSequence({
    segments: [{ ...phrase(64, 66)[0], beats: [4, 0.5] }],
    intervalMs: 700,
    guitar: {
      play: async midi => { events.push(['play', midi]); return true; },
      stop: () => events.push(['stop']),
    },
    isCurrent: () => current,
    onStep: ({ index }) => events.push(['step', index]),
    wait: ms => {
      events.push(['wait', ms]);
      paused.resolve();
      return pendingWait.promise;
    },
  });
  await paused.promise;
  current = false;
  pendingWait.resolve();

  assert.deepEqual(await run, { status: 'cancelled' });
  assert.deepEqual(events, [['play', 64], ['step', 0], ['wait', 2800]]);
});
