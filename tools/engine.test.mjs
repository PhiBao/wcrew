#!/usr/bin/env node
/**
 * wcrew — engine unit tests (pure, no DOM).
 * Run: node tools/engine.test.mjs  or  pnpm engine:test
 */
import assert from 'node:assert/strict';
import { seedState, RULES, DAYS, mondayOf } from '../src/model.js';
import {
  evaluateAssignment, checkCompliance, costBreakdown, coverage,
  planAutoFill, findSwaps, staffHours, longestRun, isAvailable, hasSkill
} from '../src/engine.js';

let ok = 0, fail = 0;
function test(name, fn) {
  try { fn(); ok++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.error(`  ✗ ${name}\n    ${e.message}`); if (e.stack) console.error(e.stack.split('\n').slice(1,3).join('\n')); }
}

console.log('[wcrew] engine.test\n');

// ── seed ──
test('seedState produces a Monday weekStart', () => {
  const s = seedState('2026-08-24');
  assert.equal(s.weekStart, '2026-08-24');
  assert.equal(s.staff.length, 10);
  assert.ok(s.shifts.length > 30);
});

test('mondayOf returns Monday ISO', () => {
  assert.equal(mondayOf(new Date('2026-08-26')), '2026-08-24'); // Wed → Mon
});

test('seed contains known prefill and open shifts', () => {
  const s = seedState('2026-08-24');
  const monBake = s.shifts.find(x => x.id === 'mon-bake');
  assert.equal(monBake.staffId, 'lena');
  const satBrunch = s.shifts.find(x => x.id === 'sat-brunch');
  assert.equal(satBrunch.staffId, 'priya');
  const open = s.shifts.filter(x => !x.staffId);
  assert.ok(open.length > 0, `expected open shifts, got ${open.length}`);
});

// ── primitives ──
test('longestRun', () => {
  assert.equal(longestRun([0,1,2,4,5]), 3);
  assert.equal(longestRun([0,2,4]), 1);
  assert.equal(longestRun([]), 0);
});

test('hasSkill / isAvailable', () => {
  const s = seedState();
  const maya = s.staff.find(p => p.id === 'maya');
  assert.equal(hasSkill(maya, 'lead'), true);
  assert.equal(hasSkill(maya, 'bake'), false);
  // Maya Mon 6-16
  assert.equal(isAvailable(maya, { day: 0, start: 7, end: 13 }), true);
  assert.equal(isAvailable(maya, { day: 0, start: 5, end: 13 }), false);
  assert.equal(isAvailable(maya, { day: 6, start: 10, end: 16 }), false);
});

// ── compliance ──
test('seed has expected seeded violations (Kofi double-book Thu, Maya Sun)', () => {
  const s = seedState();
  const c = checkCompliance(s);
  assert.equal(c.ok, false);
  assert.ok(c.error_count >= 2, `expected >=2 errors, got ${c.error_count}`);
  const codes = c.issues.map(i => i.code);
  assert.ok(codes.includes('DOUBLE_BOOKED') || codes.includes('UNAVAILABLE'), `codes: ${codes}`);
});

test('evaluateAssignment blocks SKILL_MISMATCH', () => {
  const s = seedState();
  const lena = s.staff.find(p => p.id === 'lena'); // only bake
  const barShift = s.shifts.find(x => x.role === 'bar' && x.day === 0);
  const ev = evaluateAssignment(s, barShift, lena);
  assert.equal(ev.ok, false);
  assert.ok(ev.blockers.some(b => b.code === 'SKILL_MISMATCH'));
});

test('evaluateAssignment blocks UNAVAILABLE', () => {
  const s = seedState();
  const lena = s.staff.find(p => p.id === 'lena'); // 4-12
  const close = s.shifts.find(x => x.id === 'mon-close'); // 15.5-22
  const ev = evaluateAssignment(s, close, lena);
  assert.ok(ev.blockers.some(b => b.code === 'UNAVAILABLE'));
});

test('evaluateAssignment blocks DOUBLE_BOOKED', () => {
  const s = seedState();
  const kofi = s.staff.find(p => p.id === 'kofi');
  const thuBake = s.shifts.find(x => x.id === 'thu-bake'); // 5-11 assigned kofi
  const thuBarAm = s.shifts.find(x => x.id === 'thu-bar-am'); // 7-13 also kofi → overlap
  const ev = evaluateAssignment(s, thuBarAm, kofi);
  assert.ok(ev.blockers.some(b => b.code === 'DOUBLE_BOOKED'));
});

test('evaluateAssignment blocks MINOR_CURFEW and MINOR_SHIFT_TOO_LONG', () => {
  const s = seedState();
  const jonas = s.staff.find(p => p.id === 'jonas');
  assert.equal(jonas.minor, true);
  const late = { id: 'x', day: 5, start: 15, end: 23, role: 'bar', label: 'Late Bar' };
  const ev = evaluateAssignment(s, late, jonas);
  assert.ok(ev.blockers.some(b => b.code === 'MINOR_CURFEW'));
  const long = { id: 'y', day: 5, start: 9, end: 18, role: 'bar', label: 'Bar' }; // 9h
  const ev2 = evaluateAssignment(s, long, jonas);
  assert.ok(ev2.blockers.some(b => b.code === 'MINOR_SHIFT_TOO_LONG'));
});

test('evaluateAssignment blocks DAY_TOO_LONG', () => {
  const s = seedState();
  // give Maya two shifts same day totaling >10h via synthetic
  const maya = s.staff.find(p => p.id === 'maya');
  const fake = { id: 'tmp', day: 0, start: 14, end: 20, role: 'lead', label: 'Extra' }; // 6h
  // Maya already has mon-bake? no, but mon-open 6.5-13 (6.5h) + mon-bake not hers, she has mon-open 6.5h + this 6h = 12.5 >10
  // Need a shift she already has: mon-open 6.5-13 =6.5h
  const ev = evaluateAssignment(s, fake, maya);
  // 6.5+6=12.5 >10 so should block
  assert.ok(ev.blockers.some(b => b.code === 'DAY_TOO_LONG'));
});

test('checkCompliance de-dupes PER_STAFF_DAY', () => {
  const s = seedState();
  const c = checkCompliance(s);
  // DAY_TOO_LONG and TOO_MANY_CONSECUTIVE_DAYS should not duplicate per day/staff
  const keys = c.issues.map(i => `${i.code}|${i.staff_id}|${i.day}`);
  assert.equal(keys.length, new Set(keys).size);
});

test('staffHours / costBreakdown', () => {
  const s = seedState();
  const h = staffHours(s, 'lena');
  assert.ok(h > 0);
  const cost = costBreakdown(s);
  assert.ok(cost.total > 0);
  assert.equal(typeof cost.over_budget_by, 'number');
});

test('coverage', () => {
  const s = seedState();
  const c = coverage(s);
  assert.ok(c.open > 0);
  assert.ok(c.coverage_pct < 100);
  assert.ok(c.coverage_pct >= 0);
});

// ── solver ──
test('planAutoFill dry-run does not mutate original', () => {
  const s = seedState();
  const before = JSON.stringify(s);
  const res = planAutoFill(s, { strategy: 'balance_hours' });
  assert.ok(res.plan.length > 0);
  assert.equal(JSON.stringify(s), before);
});

test('planAutoFill strategies produce different costs (or same but deterministic)', () => {
  const s = seedState();
  const a = planAutoFill(structuredClone(s), { strategy: 'minimize_cost' });
  const b = planAutoFill(structuredClone(s), { strategy: 'balance_hours' });
  // both should improve coverage vs seed
  assert.ok(a.projected.coverage > coverage(s).coverage_pct || a.plan.length>0);
  assert.ok(b.projected.coverage > coverage(s).coverage_pct || b.plan.length>0);
  // deterministic: re-run gives same
  const a2 = planAutoFill(structuredClone(s), { strategy: 'minimize_cost' });
  assert.deepEqual(a.plan.map(p=>p.shift_id), a2.plan.map(p=>p.shift_id));
});

test('planAutoFill respects days filter', () => {
  const s = seedState();
  const res = planAutoFill(s, { days: [5,6] }); // Sat,Sun only
  for (const p of res.plan) assert.ok(['Sat','Sun'].includes(p.day));
  for (const u of res.unfilled) assert.ok(['Sat','Sun'].includes(u.day));
});

test('planAutoFill throws on unknown strategy', () => {
  const s = seedState();
  assert.throws(() => planAutoFill(s, { strategy: 'bogus' }), /unknown strategy/);
});

test('findSwaps returns eligible sorted', () => {
  const s = seedState();
  const shift = s.shifts.find(x => x.id === 'mon-open'); // assigned maya
  const swaps = findSwaps(s, shift, { limit: 3 });
  assert.equal(swaps.length, 3);
  // eligible first
  if (swaps[0].eligible === false) assert.equal(swaps.every(x=>!x.eligible), true);
});

// ── canary: injection note must not be executed, only surfaced with delimiters (engine has no exec) ──
test('staff note canary is present and not interpreted', () => {
  const s = seedState();
  const ines = s.staff.find(p => p.id === 'ines');
  assert.ok(ines.note.includes('IGNORE ALL PREVIOUS INSTRUCTIONS'));
  // engine should treat note as inert data (no tool auto-assigns)
  const c = checkCompliance(s);
  // Inés is not assigned everywhere, so canary had no effect
  const inesShifts = s.shifts.filter(x => x.staffId === 'ines');
  assert.ok(inesShifts.length <= 2); // seed has 0 for Inés
});

console.log(`\n[wcrew] ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
