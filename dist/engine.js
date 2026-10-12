/** Guitar note and spaced-retrieval model. No DOM or storage dependencies. */
export const NOTES_SHARP = Object.freeze(['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
export const NOTES_FLAT = Object.freeze(['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']);
const OPEN = [0, 64, 59, 55, 50, 45, 40];
const NATURALS = new Set([0, 2, 4, 5, 7, 9, 11]);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const INTERVALS = [45_000, 5 * MINUTE, DAY, 3 * DAY, 7 * DAY, 21 * DAY];
const safeInt = (value, fallback = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function noteName(pc, flats = false) {
  return (flats ? NOTES_FLAT : NOTES_SHARP)[((Math.trunc(pc) % 12) + 12) % 12] ?? '—';
}

export function midiFor(string, fret) {
  if (!Number.isInteger(string) || string < 1 || string > 6 || !Number.isInteger(fret) || fret < 0 || fret > 24) {
    throw new RangeError('弦は1〜6、フレットは0〜24で指定してください。');
  }
  return OPEN[string] + fret;
}

export function pitchClass(string, fret) { return midiFor(string, fret) % 12; }

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

export function createProgress() {
  return { version: 1, cards: {}, sessions: [], activityDays: [], totalAnswers: 0, totalCorrect: 0 };
}

/** Treat browser storage as untrusted. Rebuild fields instead of merging objects. */
export function sanitizeProgress(value) {
  const result = createProgress();
  if (!isObject(value)) return result;
  if (isObject(value.cards)) {
    for (const [id, raw] of Object.entries(value.cards)) {
      if (!/^[1-6]-(?:[0-9]|1[0-2])$/.test(id) || !isObject(raw)) continue;
      const seen = safeInt(raw.seen, 0, 1_000_000);
      if (seen === 0) continue;
      const correct = safeInt(raw.correct, 0, seen);
      result.cards[id] = {
        seen, correct,
        streak: safeInt(raw.streak, 0, correct),
        level: safeInt(raw.level, 0, Math.min(5, correct)),
        dueAt: safeInt(raw.dueAt),
        lastSeen: safeInt(raw.lastSeen),
        totalMs: safeInt(raw.totalMs, 0, seen * 120_000),
      };
      result.totalAnswers += seen;
      result.totalCorrect += correct;
    }
  }
  if (Array.isArray(value.sessions)) {
    result.sessions = value.sessions.filter(isObject).slice(-365).map((session) => {
      const clean = {};
      for (const [key, val] of Object.entries(session)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
        if (typeof val === 'number' && Number.isFinite(val)) clean[key] = Math.max(0, val);
        else if (typeof val === 'string') clean[key] = val.slice(0, 200);
        else if (typeof val === 'boolean') clean[key] = val;
      }
      return clean;
    });
  }
  // Preserve recoverable history when loading records from before activityDays.
  result.activityDays = cleanActivityDays([
    ...(Array.isArray(value.activityDays) ? value.activityDays : []),
    ...Object.values(result.cards).filter((card) => card.lastSeen > 0).map((card) => localDateKey(card.lastSeen)),
    ...result.sessions.map((session) => localDateKey(session.completedAt ?? session.startedAt ?? session.date)),
  ]);
  return result;
}

/**
 * Immediate repairs first, then a balance of spaced review, weak cards and discovery.
 * The review queue is owned by the caller so a failed card can return after a few
 * intervening questions. Recent positions are avoided whenever the range permits.
 */
export function chooseQuestion(progress, settings = {}, recentIds = [], reviewQueue = []) {
  const positions = allPositions(settings);
  if (!positions.length) return null;
  const byId = new Map(positions.map((position) => [position.id, position]));
  const recent = new Set((Array.isArray(recentIds) ? recentIds : []).slice(-3));
  const available = positions.filter((position) => !recent.has(position.id));
  const candidates = available.length ? available : positions.filter((position) => position.id !== recentIds.at?.(-1));
  const pool = candidates.length ? candidates : positions;
  const allowedIds = new Set(pool.map((position) => position.id));
  const queue = Array.isArray(reviewQueue) ? reviewQueue : [];
  for (const item of queue) {
    const id = typeof item === 'string' ? item : item?.id;
    if (byId.has(id) && allowedIds.has(id)) return { ...byId.get(id), reason: 'review' };
  }
  const cards = isObject(progress?.cards) ? progress.cards : {};
  const now = Date.now();
  const due = pool.filter((p) => cards[p.id]?.seen > 0 && cards[p.id].dueAt <= now);
  const unseen = pool.filter((p) => !cards[p.id]?.seen);
  const weak = pool.filter((p) => cards[p.id]?.seen > 0 && (cards[p.id].level < 2 || cards[p.id].correct / cards[p.id].seen < 0.75));
  const pick = (items, reason) => ({ ...items[Math.floor(Math.random() * items.length)], reason });
  // Every fourth answer opens a new location even when a large backlog is due.
  if (unseen.length && safeInt(progress?.totalAnswers) % 4 === 3) return pick(unseen, 'new');
  if (due.length) {
    due.sort((a, b) => cards[a.id].dueAt - cards[b.id].dueAt);
    return pick(due.slice(0, 4), 'review');
  }
  // Unseen locations get two turns out of three; weak positions get retrieval practice.
  if (unseen.length && (!weak.length || safeInt(progress?.totalAnswers) % 3 !== 2)) return pick(unseen, 'new');
  if (weak.length) return pick(weak, 'weak');
  if (unseen.length) return pick(unseen, 'new');
  return pick(pool, 'practice');
}

export function recordAnswer(progress, position, { correct, assisted = false, elapsedMs = 0, now = Date.now() } = {}) {
  if (!progress || !position || !/^[1-6]-(?:[0-9]|1[0-2])$/.test(position.id)) throw new TypeError('有効な学習記録と指板位置が必要です。');
  if (!isObject(progress.cards)) progress.cards = {};
  const prior = progress.cards[position.id];
  const card = prior || { seen: 0, correct: 0, streak: 0, level: 0, dueAt: 0, lastSeen: 0, totalMs: 0 };
  const timestamp = safeInt(now, Date.now());
  const canAdvance = !prior || timestamp >= card.dueAt;
  card.seen += 1;
  card.correct += correct ? 1 : 0;
  card.lastSeen = timestamp;
  // A backgrounded tab should not turn a retrieval-time metric into hours.
  card.totalMs += safeInt(elapsedMs, 0, 120_000);
  if (!correct) {
    card.streak = 0;
    card.level = Math.max(0, card.level - 2);
    card.dueAt = timestamp + INTERVALS[0];
  } else if (assisted) {
    card.streak = 0;
    card.dueAt = timestamp + 90_000;
  } else {
    card.streak += 1;
    if (canAdvance) {
      card.level = Math.min(5, card.level + 1);
      card.dueAt = timestamp + INTERVALS[card.level];
    }
  }
  progress.cards[position.id] = card;
  progress.activityDays = cleanActivityDays([
    ...(Array.isArray(progress.activityDays) ? progress.activityDays : []),
    localDateKey(timestamp),
  ]);
  progress.totalAnswers = safeInt(progress.totalAnswers) + 1;
  progress.totalCorrect = safeInt(progress.totalCorrect) + (correct ? 1 : 0);
  return card;
}

export function masteryFor(progress, id) {
  const card = progress?.cards?.[id];
  return card?.seen ? Math.max(0, Math.min(5, Number(card.level) || 0)) / 5 : 0;
}

function localDateKey(timestamp) {
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return null;
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanActivityDays(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((day) => typeof day === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && localDateKey(`${day}T12:00:00`) === day))].sort().slice(-366);
}

export function getStats(progress, settings = {}) {
  const positions = allPositions(settings);
  const cards = progress?.cards || {};
  const now = Date.now();
  let seen = 0, mastered = 0, due = 0, answers = 0, correct = 0, totalMs = 0;
  for (const p of positions) {
    const card = cards[p.id];
    if (!card?.seen) continue;
    seen += 1;
    if (masteryFor(progress, p.id) >= 0.8) mastered += 1;
    if (card.dueAt <= now) due += 1;
    answers += card.seen;
    correct += card.correct;
    totalMs += card.totalMs;
  }
  const days = new Set(cleanActivityDays(progress?.activityDays));
  for (const card of Object.values(cards)) if (card.lastSeen > 0) days.add(localDateKey(card.lastSeen));
  for (const session of progress?.sessions || []) {
    const stamp = session.completedAt ?? session.startedAt ?? session.date;
    const key = localDateKey(stamp);
    if (key) days.add(key);
  }
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streakDays = 0;
  while (days.has(localDateKey(cursor)) && streakDays < 366) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { seen, mastered, total: positions.length, accuracy: answers ? correct / answers * 100 : 0, due,
    averageSeconds: answers ? totalMs / answers / 1000 : 0, streakDays };
}

export function relationshipHint(position, flats = false) {
  const { string, fret } = position;
  const pc = pitchClass(string, fret);
  const name = noteName(pc, flats);
  const makeAnchor = (s, f) => ({ string: s, fret: f, midi: midiFor(s, f), pc: pitchClass(s, f) });
  if (fret === 0) return {
    title: '開放弦を、帰る場所に。',
    body: `太い6弦から E・A・D・G・B・E。${string}弦の開放弦は ${name} です。`,
    anchor: makeAnchor(string, 0), label: `${string}弦の開放弦`,
  };
  if (fret === 12) return {
    title: '12フレットで、同じ音名に戻る。',
    body: `${string}弦の開放弦 ${name} から12半音。1オクターブ高い ${name} です。`,
    anchor: makeAnchor(string, 0), label: '同じ弦の開放弦',
  };
  // Go two strings toward the bass. Crossing the B string changes +2 to +3 frets.
  if (string <= 4) {
    const bassString = string + 2;
    const offset = string <= 2 ? 3 : 2;
    const bassFret = fret - offset;
    if (bassFret >= 0) return {
      title: 'オクターブの形で、つなぐ。',
      body: `${bassString}弦${bassFret}フレットの ${name} から、細い弦へ2本・右へ${offset}フレット。音名は同じ ${name}。${offset === 3 ? '2弦をまたぐ形では、右へ3フレットです。' : '高さは1オクターブ上です。'}`,
      anchor: makeAnchor(bassString, bassFret), label: `${bassString}弦 ${bassFret}F と同じ音名`,
    };
  }
  const open = noteName(OPEN[string] % 12, flats);
  const halfSteps = fret === 1 ? '半音1つ' : `半音${fret}個`;
  return {
    title: '開放弦から、半音でたどる。',
    body: `${string}弦の開放弦は ${open}。1フレットで半音上がるので、${halfSteps}上がると ${name}。E→F と B→C の間に黒鍵の音はありません。`,
    anchor: makeAnchor(string, 0), label: `${open} から +${fret} 半音`,
  };
}
