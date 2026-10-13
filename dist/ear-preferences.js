import { LEVELS, DIFFICULTIES } from './ear-model.js?v=20261013-narrow-span';

const STORAGE_KEY = 'guitar-ear-training.preferences.v1';
export const DEFAULT_PREFERENCES = Object.freeze({ level: 'single', difficulty: 'normal', volume: 0.45, speed: 1, boardView: 'detail' });

export function sanitizePreferences(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // An old fretboard range says nothing about the requested listening difficulty.
  const difficulty = value.difficulty;
  return {
    level: LEVELS.some(item => item.id === value.level) ? value.level : DEFAULT_PREFERENCES.level,
    difficulty: DIFFICULTIES.some(item => item.id === difficulty) ? difficulty : DEFAULT_PREFERENCES.difficulty,
    volume: typeof value.volume === 'number' && Number.isFinite(value.volume)
      ? Math.max(0.1, Math.min(0.8, value.volume)) : DEFAULT_PREFERENCES.volume,
    speed: value.speed === 0.7 ? 0.7 : 1,
    boardView: value.boardView === 'overview' ? 'overview' : DEFAULT_PREFERENCES.boardView,
  };
}

export function loadPreferences(storage) {
  try {
    // Accessing localStorage itself can throw in blocked/private contexts.
    const store = storage === undefined ? globalThis.localStorage : storage;
    return sanitizePreferences(JSON.parse(store.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences, storage) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    store.setItem(STORAGE_KEY, JSON.stringify(sanitizePreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}
