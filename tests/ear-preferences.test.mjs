import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, sanitizePreferences, loadPreferences, savePreferences } from '../dist/ear-preferences.js';

const KEY = 'guitar-ear-training.preferences.v1';
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('preferences keep supported options and exclude unknown fields', () => {
  const valid = { level: 'phrase', difficulty: 'normal', volume: 0.65, speed: 0.7, boardView: 'overview' };
  assert.deepEqual(sanitizePreferences({ ...valid, target: [64], answers: 20 }), valid);
  for (const level of ['single', 'pair', 'triple', 'phrase']) {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      assert.deepEqual(sanitizePreferences({ level, difficulty }), { ...DEFAULT_PREFERENCES, level, difficulty });
    }
  }
  assert.deepEqual(sanitizePreferences({ level: 'unknown', difficulty: 'unknown', speed: 2 }), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences(JSON.parse('{"__proto__":{"polluted":true},"level":"pair"}')), { ...DEFAULT_PREFERENCES, level: 'pair' });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.isFrozen(DEFAULT_PREFERENCES), true);
});

test('board views and difficulty survive saving and loading without changing practice settings', () => {
  const storage = memoryStorage();
  for (const boardView of ['detail', 'overview']) {
    const preferences = { ...DEFAULT_PREFERENCES, difficulty: 'hard', boardView };
    assert.deepEqual(sanitizePreferences(preferences), preferences);
    assert.equal(savePreferences(preferences, storage), true);
    assert.deepEqual(JSON.parse(storage.getItem(KEY)), preferences);
    assert.deepEqual(loadPreferences(storage), preferences);
    assert.equal(loadPreferences(storage).level, 'single');
  }
});

test('missing and malformed board views fall back to detail on sanitize, load, and save', () => {
  assert.equal(DEFAULT_PREFERENCES.boardView, 'detail');
  const storage = memoryStorage();
  for (const boardView of [undefined, null, '', 'wide', 'DETAIL', 1, true, ['overview'], { view: 'overview' }]) {
    const input = { level: 'pair', difficulty: 'hard', boardView };
    const expected = { ...DEFAULT_PREFERENCES, level: 'pair', difficulty: 'hard', boardView: 'detail' };
    assert.deepEqual(sanitizePreferences(input), expected);
    storage.setItem(KEY, JSON.stringify(input));
    assert.deepEqual(loadPreferences(storage), expected);
    assert.equal(savePreferences(input, storage), true);
    assert.deepEqual(JSON.parse(storage.getItem(KEY)), expected);
  }
});

test('legacy musical settings are discarded while other saved preferences survive', () => {
  const storage = memoryStorage();
  const expected = { level: 'phrase', difficulty: 'hard', volume: 0.65, speed: 0.7, boardView: 'overview' };
  assert.equal('style' in DEFAULT_PREFERENCES, false);
  assert.equal('tonic' in DEFAULT_PREFERENCES, false);
  for (const style of ['chromatic', 'major', 'pentatonic', 'blues', 'unknown']) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const legacy = { ...expected, style, tonic };
      assert.deepEqual(sanitizePreferences(legacy), expected);
      storage.setItem(KEY, JSON.stringify(legacy));
      assert.deepEqual(loadPreferences(storage), expected);
      assert.equal(savePreferences(legacy, storage), true);
      assert.deepEqual(JSON.parse(storage.getItem(KEY)), expected);
    }
  }
});

test('legacy ranges migrate only when difficulty is absent and are never saved again', () => {
  const storage = memoryStorage();
  assert.equal(DEFAULT_PREFERENCES.difficulty, 'normal');
  assert.equal('range' in DEFAULT_PREFERENCES, false);
  for (const [range, difficulty] of [['first', 'easy'], ['low', 'easy'], ['full', 'normal'], ['extended', 'hard'], ['invalid', 'normal']]) {
    const legacy = { level: 'triple', range, volume: 0.6, speed: 0.7, boardView: 'overview' };
    const expected = { level: 'triple', difficulty, volume: 0.6, speed: 0.7, boardView: 'overview' };
    assert.deepEqual(sanitizePreferences(legacy), expected);
    storage.setItem(KEY, JSON.stringify(legacy));
    assert.deepEqual(loadPreferences(storage), expected);
    assert.equal(savePreferences(legacy, storage), true);
    assert.deepEqual(JSON.parse(storage.getItem(KEY)), expected);
    assert.equal('range' in loadPreferences(storage), false);
  }
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const range of ['first', 'low', 'full', 'extended']) {
      assert.equal(sanitizePreferences({ difficulty, range }).difficulty, difficulty);
    }
  }
  for (const difficulty of [undefined, null, '', 'invalid', 3, true, [], {}]) {
    assert.equal(sanitizePreferences({ difficulty, range: 'extended' }).difficulty, 'normal');
  }
});

test('volume accepts only finite numbers, clamps zero and extremes, and rejects strings', () => {
  for (const [value, expected] of [[0, 0.1], [-50, 0.1], [0.1, 0.1], [0.6, 0.6], [0.8, 0.8], [9, 0.8]]) {
    assert.equal(sanitizePreferences({ volume: value }).volume, expected);
  }
  for (const volume of [NaN, Infinity, -Infinity, '0.7', '', null, true, {}, []]) {
    assert.equal(sanitizePreferences({ volume }).volume, DEFAULT_PREFERENCES.volume);
  }
  for (const speed of [1, 0.7]) assert.equal(sanitizePreferences({ speed }).speed, speed);
  for (const speed of [0, 0.5, 0.8, '0.7', NaN, null]) assert.equal(sanitizePreferences({ speed }).speed, 1);
});

test('missing, malformed and corrupted stored settings safely load defaults', () => {
  for (const raw of [null, undefined, false, 42, 'pair', [], ['phrase']]) {
    assert.deepEqual(sanitizePreferences(raw), DEFAULT_PREFERENCES);
  }
  const storage = memoryStorage();
  assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
  for (const raw of ['{bad JSON', 'null', '[]', '42', '"pair"']) {
    storage.setItem(KEY, raw);
    assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
  }
  storage.setItem(KEY, '{"level":"pair","volume":0,"speed":0.7,"unused":true}');
  assert.deepEqual(loadPreferences(storage), { ...DEFAULT_PREFERENCES, level: 'pair', volume: 0.1, speed: 0.7 });
});

test('save uses the dedicated key and sanitizes the persisted payload', () => {
  const storage = memoryStorage();
  assert.equal(savePreferences({ level: 'pair', difficulty: 'hard', volume: 8, speed: 0.7, extra: 1 }, storage), true);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)), { ...DEFAULT_PREFERENCES, level: 'pair', difficulty: 'hard', volume: 0.8, speed: 0.7 });
  assert.deepEqual(loadPreferences(storage), { ...DEFAULT_PREFERENCES, level: 'pair', difficulty: 'hard', volume: 0.8, speed: 0.7 });
  const loaded = loadPreferences(storage);
  loaded.level = 'single';
  assert.equal(loadPreferences(storage).level, 'pair');
});

test('denied storage method access and unavailable storage never throw', () => {
  const denied = () => { throw new Error('Storage denied'); };
  for (const storage of [null, {}, { getItem: denied, setItem: denied }, { get getItem() { return denied(); }, get setItem() { return denied(); } }]) {
    assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);
    assert.equal(savePreferences(DEFAULT_PREFERENCES, storage), false);
  }
});

test('a throwing global localStorage getter is caught during both load and save', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Getter denied'); } });
    assert.deepEqual(loadPreferences(), DEFAULT_PREFERENCES);
    assert.equal(savePreferences(DEFAULT_PREFERENCES), false);
    assert.deepEqual(loadPreferences(undefined), DEFAULT_PREFERENCES);
    assert.equal(savePreferences(DEFAULT_PREFERENCES, undefined), false);
    // An explicitly injected store does not touch the denied global getter.
    const storage = memoryStorage();
    assert.equal(savePreferences({ level: 'phrase' }, storage), true);
    assert.equal(loadPreferences(storage).level, 'phrase');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
