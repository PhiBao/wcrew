/**
 * wcrew — state container.
 *
 * One mutable reference, immutable snapshots, an explicit undo stack and a
 * subscribe() feed. Both the human UI and the agent tools go through here, so
 * every change — whoever made it — is observable, attributable and reversible.
 * That is the trust contract of an agent-editable app: the manager must always
 * be able to see what happened and take it back.
 *
 * Zero dependencies. Works in a browser (localStorage) and in Node (memory).
 */

import { seedState, mondayOf } from './model.js';

const KEY = 'wcrew.state.v1';
const HISTORY_LIMIT = 40;
const LOG_LIMIT = 60;

const clone = (v) => structuredClone(v);

/** localStorage if usable, otherwise an in-memory stub (Node, private mode). */
function storage() {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no localStorage');
    localStorage.setItem('wcrew.probe', '1');
    localStorage.removeItem('wcrew.probe');
    return localStorage;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => void mem.set(k, String(v)),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

/**
 * Reject anything that is not recognisably a wcrew state. Restoring a
 * half-valid object from disk would surface as mystery bugs deep in the engine,
 * so a stale or tampered payload is discarded in favour of a clean seed.
 */
function isUsable(state) {
  return !!state && state.v === 1 &&
    Array.isArray(state.staff) && state.staff.length > 0 &&
    Array.isArray(state.shifts) && state.shifts.length > 0 &&
    typeof state.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.weekStart) &&
    state.shifts.every((s) => typeof s.id === 'string' && typeof s.day === 'number' &&
      typeof s.start === 'number' && typeof s.end === 'number');
}

export function createStore({ persist = true, state: initial = null } = {}) {
  const disk = persist ? storage() : null;

  let state = initial ? clone(initial) : load();
  let past = [];
  let future = [];
  let log = [];
  let seq = 0;
  const listeners = new Set();

  function load() {
    if (!disk) return seedState();
    try {
      const raw = disk.getItem(KEY);
      if (!raw) return seedState();
      const parsed = JSON.parse(raw);
      if (!isUsable(parsed)) return seedState();
      // A saved roster for a past week is history, not this week's work.
      if (parsed.weekStart !== mondayOf()) return seedState();
      return parsed;
    } catch {
      return seedState();
    }
  }

  function save() {
    if (!disk) return;
    try {
      disk.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota or private mode — the app stays fully usable in memory */
    }
  }

  function emit(event) {
    for (const fn of [...listeners]) {
      try {
        fn(event, state);
      } catch (err) {
        console.error('[wcrew] subscriber failed', err);
      }
    }
  }

  return {
    /** Read-only snapshot. Callers may mutate it freely; the store is unaffected. */
    get: () => clone(state),
    /** Live reference — engine functions are pure, so reads are safe and cheap. */
    peek: () => state,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * Apply a change.
     * @param {string} summary human sentence for the activity feed
     * @param {(draft) => any} mutate receives a draft to mutate in place
     * @param {{actor?: 'agent'|'user'|'system', kind?: string, meta?: object}} opts
     */
    commit(summary, mutate, { actor = 'user', kind = 'edit', meta = null } = {}) {
      const draft = clone(state);
      const result = mutate(draft);
      past.push(state);
      if (past.length > HISTORY_LIMIT) past.shift();
      future = [];
      state = draft;
      save();
      const entry = { id: ++seq, at: new Date().toISOString(), actor, kind, summary, meta };
      log.unshift(entry);
      if (log.length > LOG_LIMIT) log.pop();
      emit({ type: 'commit', entry });
      return result;
    },

    /** Record something worth showing the manager that changed no data. */
    note(summary, { actor = 'agent', kind = 'read', meta = null } = {}) {
      const entry = { id: ++seq, at: new Date().toISOString(), actor, kind, summary, meta };
      log.unshift(entry);
      if (log.length > LOG_LIMIT) log.pop();
      emit({ type: 'note', entry });
      return entry;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    undo({ actor = 'user' } = {}) {
      if (!past.length) return false;
      future.unshift(state);
      state = past.pop();
      save();
      const entry = { id: ++seq, at: new Date().toISOString(), actor, kind: 'undo', summary: 'Undid the last change', meta: null };
      log.unshift(entry);
      emit({ type: 'undo', entry });
      return true;
    },

    redo({ actor = 'user' } = {}) {
      if (!future.length) return false;
      past.push(state);
      state = future.shift();
      save();
      const entry = { id: ++seq, at: new Date().toISOString(), actor, kind: 'redo', summary: 'Redid the last undone change', meta: null };
      log.unshift(entry);
      emit({ type: 'redo', entry });
      return true;
    },

    /** Fresh seed week. Destructive, so the UI gates it behind a confirmation. */
    reset({ actor = 'user' } = {}) {
      past.push(state);
      state = seedState();
      future = [];
      save();
      const entry = { id: ++seq, at: new Date().toISOString(), actor, kind: 'reset', summary: 'Reset the week to the starting roster', meta: null };
      log.unshift(entry);
      emit({ type: 'reset', entry });
    },

    activity: (n = 20) => log.slice(0, n).map(clone),
  };
}
