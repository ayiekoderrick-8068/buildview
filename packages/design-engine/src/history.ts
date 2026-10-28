/**
 * Snapshot-based undo/redo. Documents are immutable and structurally shared, so keeping
 * snapshots is cheap and keeps undo trivially correct.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export interface CommitOptions {
  /** Consecutive commits with the same key inside `coalesceMs` become one undo step. */
  key?: string;
  now?: number;
  coalesceMs?: number;
}

const LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function commit<T>(h: History<T>, next: T, opts: CommitOptions = {}): History<T> {
  if (next === h.present) return h;
  const now = opts.now ?? Date.now();
  const key = opts.key ?? null;
  const coalesce = key !== null && key === h.lastKey && now - h.lastAt <= (opts.coalesceMs ?? 800);
  const past = coalesce ? h.past : [...h.past, h.present].slice(-LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

/** Replace the present without recording history (used for live drags). */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

/**
 * Finish a transient interaction: record `base` (the state before the interaction began) as one
 * undo step, but only if something actually changed.
 */
export function commitTransient<T>(h: History<T>, base: T): History<T> {
  if (base === h.present) return h;
  return { past: [...h.past, base].slice(-LIMIT), present: h.present, future: [], lastKey: null, lastAt: 0 };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
