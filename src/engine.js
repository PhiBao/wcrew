/**
 * wcrew — scheduling engine.
 * Pure functions over a roster state: compliance, labour cost, coverage and a
 * deterministic auto-fill solver. No DOM, no I/O — this file is what makes the
 * agent-facing tools trustworthy, because every answer is computed, not guessed.
 */

import {
  RULES, DAYS, DAY_LONG, ROLES, shiftHours, overlaps, round2, fmtHour, getStaff, money, addDays,
} from './model.js';

const abs = (day, hour) => day * 24 + hour;

/* ------------------------------------------------------------- primitives --- */

export const assignedShifts = (state, staffId) =>
  state.shifts.filter((s) => s.staffId === staffId)
    .sort((a, b) => a.day - b.day || a.start - b.start);

export const staffHours = (state, staffId) =>
  round2(assignedShifts(state, staffId).reduce((n, s) => n + shiftHours(s), 0));

export const daysWorked = (state, staffId) =>
  [...new Set(assignedShifts(state, staffId).map((s) => s.day))].sort((a, b) => a - b);

export function longestRun(days) {
  let best = 0, run = 0, prev = -99;
  for (const d of days) { run = d === prev + 1 ? run + 1 : 1; prev = d; best = Math.max(best, run); }
  return best;
}

export function isAvailable(staff, shift) {
  const w = staff.availability[shift.day];
  return Array.isArray(w) && shift.start >= w[0] && shift.end <= w[1];
}

export function hasSkill(staff, role) {
  return staff.skills.includes(role);
}

/* --------------------------------------------------------------- costing --- */

export function costBreakdown(state) {
  const byStaff = state.staff.map((p) => {
    const hours = staffHours(state, p.id);
    const overtime = round2(Math.max(0, hours - p.maxHours));
    const normal = round2(hours - overtime);
    const cost = round2(normal * p.rate + overtime * p.rate * RULES.OVERTIME_MULTIPLIER);
    return { staff_id: p.id, name: p.name, hours, overtime_hours: overtime, max_hours: p.maxHours, rate: p.rate, cost };
  });
  const total = round2(byStaff.reduce((n, r) => n + r.cost, 0));
  const hours = round2(byStaff.reduce((n, r) => n + r.hours, 0));
  const overtime = round2(byStaff.reduce((n, r) => n + r.overtime_hours, 0));
  return {
    total, budget: state.budget, over_budget_by: round2(Math.max(0, total - state.budget)),
    headroom: round2(state.budget - total), scheduled_hours: hours, overtime_hours: overtime,
    by_staff: byStaff.filter((r) => r.hours > 0).sort((a, b) => b.cost - a.cost),
  };
}

/* -------------------------------------------------------------- coverage --- */

export function coverage(state) {
  const open = state.shifts.filter((s) => !s.staffId);
  const total = state.shifts.length;
  return {
    total_shifts: total,
    filled: total - open.length,
    open: open.length,
    coverage_pct: total ? Math.round(((total - open.length) / total) * 100) : 100,
    open_shifts: open.map((s) => describeShift(state, s)),
  };
}

export const describeShift = (state, s) => ({
  shift_id: s.id,
  day: DAYS[s.day],
  date: addDays(state.weekStart, s.day),
  start: fmtHour(s.start),
  end: fmtHour(s.end),
  hours: shiftHours(s),
  role: s.role,
  role_label: ROLES[s.role]?.label ?? s.role,
  label: s.label,
  assigned_to: s.staffId ? (getStaff(state, s.staffId)?.name ?? s.staffId) : null,
  staff_id: s.staffId,
  locked: !!s.locked,
});

/* ------------------------------------------------------------ compliance --- */

const issue = (severity, code, message, extra = {}) => ({ severity, code, message, ...extra });

/**
 * What would break if `staff` took `shift`? Used both by check_compliance and by
 * the solver, so the rules can never disagree between "explain" and "do".
 */
export function evaluateAssignment(state, shift, staff, { ignoreShiftId = null } = {}) {
  const blockers = [];
  const warnings = [];

  if (!hasSkill(staff, shift.role)) {
    blockers.push(issue('error', 'SKILL_MISMATCH',
      `${staff.name} is not trained for ${ROLES[shift.role]?.label ?? shift.role} (skills: ${staff.skills.join(', ')})`));
  }
  if (!isAvailable(staff, shift)) {
    const w = staff.availability[shift.day];
    blockers.push(issue('error', 'UNAVAILABLE',
      w ? `${staff.name} is only available ${DAYS[shift.day]} ${fmtHour(w[0])}–${fmtHour(w[1])}, shift is ${fmtHour(shift.start)}–${fmtHour(shift.end)}`
        : `${staff.name} is not available on ${DAY_LONG[shift.day]}`));
  }
  const mine = assignedShifts(state, staff.id).filter((s) => s.id !== shift.id && s.id !== ignoreShiftId);
  const clash = mine.find((s) => overlaps(s, shift));
  if (clash) {
    blockers.push(issue('error', 'DOUBLE_BOOKED',
      `${staff.name} already works ${clash.label} ${DAYS[clash.day]} ${fmtHour(clash.start)}–${fmtHour(clash.end)}`,
      { conflicting_shift_id: clash.id }));
  }
  if (staff.minor) {
    if (shift.end > RULES.MINOR_CURFEW_HOUR) {
      blockers.push(issue('error', 'MINOR_CURFEW',
        `${staff.name} is under 18 and cannot work past ${fmtHour(RULES.MINOR_CURFEW_HOUR)} (shift ends ${fmtHour(shift.end)})`));
    }
    if (shiftHours(shift) > RULES.MINOR_MAX_SHIFT_HOURS) {
      blockers.push(issue('error', 'MINOR_SHIFT_TOO_LONG',
        `${staff.name} is under 18: max ${RULES.MINOR_MAX_SHIFT_HOURS}h per shift (shift is ${shiftHours(shift)}h)`));
    }
  }
  const sameDay = mine.filter((s) => s.day === shift.day);
  const dayHours = round2(sameDay.reduce((n, s) => n + shiftHours(s), 0) + shiftHours(shift));
  if (dayHours > RULES.MAX_DAILY_HOURS) {
    blockers.push(issue('error', 'DAY_TOO_LONG',
      `${staff.name} would work ${dayHours}h on ${DAY_LONG[shift.day]} (max ${RULES.MAX_DAILY_HOURS}h per day)`));
  }
  for (const s of mine) {
    if (s.day === shift.day) continue;
    const gap = Math.min(
      Math.abs(abs(shift.day, shift.start) - abs(s.day, s.end)),
      Math.abs(abs(s.day, s.start) - abs(shift.day, shift.end)),
    );
    if (gap < RULES.MIN_REST_HOURS) {
      blockers.push(issue('error', 'SHORT_REST',
        `only ${round2(gap)}h rest between ${s.label} (${DAYS[s.day]}) and ${shift.label} (${DAYS[shift.day]}) — ${RULES.MIN_REST_HOURS}h required`,
        { conflicting_shift_id: s.id }));
      break;
    }
  }
  const run = longestRun([...new Set([...mine.map((s) => s.day), shift.day])].sort((a, b) => a - b));
  if (run > RULES.MAX_CONSECUTIVE_DAYS) {
    blockers.push(issue('error', 'TOO_MANY_CONSECUTIVE_DAYS',
      `${staff.name} would work ${run} days in a row (max ${RULES.MAX_CONSECUTIVE_DAYS})`));
  }

  const hoursAfter = round2(mine.reduce((n, s) => n + shiftHours(s), 0) + shiftHours(shift));
  if (hoursAfter > staff.maxHours) {
    warnings.push(issue('warning', 'OVER_MAX_HOURS',
      `${staff.name} would reach ${hoursAfter}h vs ${staff.maxHours}h contracted — ${round2(hoursAfter - staff.maxHours)}h at ${RULES.OVERTIME_MULTIPLIER}× overtime`,
      { overtime_hours: round2(hoursAfter - staff.maxHours) }));
  }
  if (staff.prefersOff.includes(shift.day)) {
    warnings.push(issue('warning', 'AGAINST_PREFERENCE',
      `${staff.name} asked not to work ${DAY_LONG[shift.day]}`));
  }
  return { ok: blockers.length === 0, blockers, warnings, hours_after: hoursAfter };
}

export function checkCompliance(state, { includeOpenShifts = true } = {}) {
  const issues = [];
  for (const s of state.shifts) {
    if (!s.staffId) continue;
    const p = getStaff(state, s.staffId);
    if (!p) { issues.push(issue('error', 'UNKNOWN_STAFF', `${s.id} is assigned to missing staff "${s.staffId}"`, { shift_id: s.id })); continue; }
    const r = evaluateAssignment(state, s, p);
    for (const x of [...r.blockers, ...r.warnings]) {
      if (x.code === 'OVER_MAX_HOURS') continue; // reported once per person below
      issues.push({ ...x, shift_id: s.id, staff_id: p.id, day: DAYS[s.day] });
    }
  }
  // de-duplicate symmetric pair findings (A vs B and B vs A)
  const PER_STAFF_DAY = new Set(['DAY_TOO_LONG', 'TOO_MANY_CONSECUTIVE_DAYS']);
  const seen = new Set();
  const deduped = issues.filter((x) => {
    const key = PER_STAFF_DAY.has(x.code)
      ? [x.code, x.staff_id, x.day].join('|')
      : [x.code, ...[x.shift_id, x.conflicting_shift_id].filter(Boolean).sort()].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const p of state.staff) {
    const h = staffHours(state, p.id);
    if (h > p.maxHours) {
      deduped.push(issue('warning', 'OVER_MAX_HOURS',
        `${p.name} is scheduled ${h}h vs ${p.maxHours}h contracted (${round2(h - p.maxHours)}h overtime)`,
        { staff_id: p.id, overtime_hours: round2(h - p.maxHours) }));
    }
  }
  for (let d = 0; d < 7; d++) {
    const dayShifts = state.shifts.filter((s) => s.day === d);
    if (!dayShifts.length) continue;
    const leadOn = dayShifts.some((s) => s.staffId && getStaff(state, s.staffId)?.skills.includes(RULES.LEAD_SKILL));
    if (!leadOn) {
      deduped.push(issue('error', 'NO_LEAD_ON_DUTY',
        `${DAY_LONG[d]} has no shift lead on duty — a keyholder must be scheduled`, { day: DAYS[d] }));
    }
  }
  const cost = costBreakdown(state);
  if (cost.over_budget_by > 0) {
    deduped.push(issue('warning', 'OVER_BUDGET',
      `projected labour ${money(cost.total)} exceeds the ${money(state.budget)} weekly budget by ${money(cost.over_budget_by)}`));
  }
  if (includeOpenShifts) {
    const cov = coverage(state);
    if (cov.open > 0) {
      deduped.push(issue('warning', 'OPEN_SHIFTS',
        `${cov.open} of ${cov.total_shifts} shifts are unassigned (${cov.coverage_pct}% coverage)`,
        { shift_ids: cov.open_shifts.map((s) => s.shift_id) }));
    }
  }
  const errors = deduped.filter((x) => x.severity === 'error');
  return {
    ok: errors.length === 0,
    error_count: errors.length,
    warning_count: deduped.length - errors.length,
    publishable: errors.length === 0,
    issues: deduped.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)),
  };
}

/* ---------------------------------------------------------------- solver --- */

const STRATEGIES = Object.freeze({
  balance_hours: 'spread hours evenly across the team (default)',
  minimize_cost: 'fill with the lowest-cost eligible person, avoid overtime',
  respect_preferences: 'honour day-off requests and avoid overtime first, cost second',
});
export const strategyNames = () => Object.keys(STRATEGIES);
export const strategyHelp = () => Object.entries(STRATEGIES).map(([k, v]) => `${k}: ${v}`).join('; ');

function candidateScore(state, shift, staff, strategy) {
  const h = shiftHours(shift);
  const hours = staffHours(state, staff.id);
  const util = staff.maxHours ? (hours + h) / staff.maxHours : 1;
  const wouldOvertime = Math.max(0, hours + h - staff.maxHours);
  const cost = h * staff.rate + wouldOvertime * staff.rate * (RULES.OVERTIME_MULTIPLIER - 1);
  const pref = staff.prefersOff.includes(shift.day) ? 1 : 0;
  switch (strategy) {
    case 'minimize_cost':
      return cost + wouldOvertime * 40 + pref * 15 + util * 2;
    case 'respect_preferences':
      return pref * 400 + wouldOvertime * 120 + util * 40 + cost * 0.2;
    case 'balance_hours':
    default:
      return util * 100 + wouldOvertime * 150 + pref * 60 + cost * 0.05;
  }
}

/**
 * Deterministic greedy fill with hardest-shift-first ordering.
 * Returns a *plan*; nothing is mutated. That separation is what makes
 * `dry_run: true` honest — the preview is produced by the same code path.
 */
export function planAutoFill(state, { strategy = 'balance_hours', days = null, shiftIds = null } = {}) {
  if (!STRATEGIES[strategy]) throw new Error(`unknown strategy "${strategy}" — try one of: ${strategyNames().join(', ')}`);
  const work = structuredClone(state);
  const targets = work.shifts.filter((s) =>
    !s.staffId && !s.locked &&
    (days ? days.includes(s.day) : true) &&
    (shiftIds ? shiftIds.includes(s.id) : true));

  const plan = [];
  const unfilled = [];
  const pool = [...targets];

  while (pool.length) {
    // Re-rank every round: the scarcest shift is filled first (constraint propagation).
    const ranked = pool.map((shift) => {
      const cands = work.staff
        .map((p) => ({ p, ev: evaluateAssignment(work, shift, p) }))
        .filter((c) => c.ev.ok)
        .map((c) => ({ ...c, score: candidateScore(work, shift, c.p, strategy) }))
        .sort((a, b) => a.score - b.score || a.p.id.localeCompare(b.p.id));
      return { shift, cands };
    }).sort((a, b) => a.cands.length - b.cands.length || a.shift.day - b.shift.day || a.shift.start - b.shift.start);

    const pick = ranked[0];
    pool.splice(pool.indexOf(pick.shift), 1);
    if (!pick.cands.length) {
      const why = work.staff.map((p) => {
        const ev = evaluateAssignment(work, pick.shift, p);
        return `${p.name}: ${ev.blockers.map((b) => b.code).join('+') || 'ok'}`;
      });
      unfilled.push({ ...describeShift(work, pick.shift), reason: 'no eligible staff', detail: why });
      continue;
    }
    const best = pick.cands[0];
    const target = work.shifts.find((s) => s.id === pick.shift.id);
    target.staffId = best.p.id;
    plan.push({
      shift_id: pick.shift.id, day: DAYS[pick.shift.day], label: pick.shift.label,
      time: `${fmtHour(pick.shift.start)}–${fmtHour(pick.shift.end)}`,
      staff_id: best.p.id, name: best.p.name,
      hours_after: best.ev.hours_after,
      caveats: best.ev.warnings.map((w) => w.message),
      alternatives: pick.cands.slice(1, 4).map((c) => c.p.name),
    });
  }

  // --- repair pass ------------------------------------------------------
  // Greedy filling can paint itself into a corner: the scarcest shift grabs the
  // only person who could also have covered a later shift. Before giving up we
  // try, deterministically and one level deep, to move a shift this run created
  // onto someone else so the stranded shift becomes fillable.
  const movable = new Set(plan.map((p) => p.shift_id));
  for (let i = unfilled.length - 1; i >= 0; i--) {
    const stranded = work.shifts.find((s) => s.id === unfilled[i].shift_id);
    const fix = repairFill(work, stranded, movable, strategy);
    if (!fix) continue;
    unfilled.splice(i, 1);
    const moved = plan.find((p) => p.shift_id === fix.moved.shift_id);
    if (moved) {
      moved.staff_id = fix.moved.staff_id;
      moved.name = fix.moved.name;
      moved.note = `reassigned during repair pass to free ${stranded.id}`;
    }
    plan.push({
      shift_id: stranded.id, day: DAYS[stranded.day], label: stranded.label,
      time: `${fmtHour(stranded.start)}–${fmtHour(stranded.end)}`,
      staff_id: fix.staff_id, name: fix.name, hours_after: fix.hours_after,
      caveats: fix.caveats,
      note: `required a swap: ${fix.moved.label} ${fix.moved.day} moved to ${fix.moved.name}`,
      alternatives: [],
    });
  }
  plan.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time));

  return {
    strategy, plan, unfilled,
    projected: {
      coverage: coverage(work).coverage_pct,
      cost: costBreakdown(work),
      compliance: (({ ok, error_count, warning_count }) => ({ ok, error_count, warning_count }))(checkCompliance(work)),
    },
    next_state: work,
  };
}

/**
 * One-level backtrack: can we free `stranded` by handing one already-planned
 * shift to somebody else? Returns null when no legal rearrangement exists —
 * which is a genuine answer, not a solver giving up quietly.
 */
function repairFill(work, stranded, movable, strategy) {
  const ranked = [...work.staff].sort((a, b) =>
    candidateScore(work, stranded, a, strategy) - candidateScore(work, stranded, b, strategy) || a.id.localeCompare(b.id));

  for (const p of ranked) {
    const base = evaluateAssignment(work, stranded, p);
    if (base.ok) { // became legal after earlier repairs
      const t = work.shifts.find((s) => s.id === stranded.id);
      t.staffId = p.id;
      return { staff_id: p.id, name: p.name, hours_after: base.hours_after, caveats: base.warnings.map((w) => w.message), moved: null };
    }
    const fixable = base.blockers.every((b) => ['DOUBLE_BOOKED', 'DAY_TOO_LONG', 'SHORT_REST'].includes(b.code));
    if (!fixable) continue;

    const mine = assignedShifts(work, p.id).filter((s) => movable.has(s.id) && !s.locked);
    for (const blocker of mine) {
      const bShift = work.shifts.find((s) => s.id === blocker.id);
      bShift.staffId = null;
      const after = evaluateAssignment(work, stranded, p);
      if (after.ok) {
        const replacement = work.staff
          .filter((q) => q.id !== p.id)
          .map((q) => ({ q, ev: evaluateAssignment({ ...work, shifts: work.shifts.map((s) => (s.id === stranded.id ? { ...s, staffId: p.id } : s)) }, bShift, q) }))
          .filter((c) => c.ev.ok)
          .sort((a, b) => candidateScore(work, bShift, a.q, strategy) - candidateScore(work, bShift, b.q, strategy) || a.q.id.localeCompare(b.q.id))[0];
        if (replacement) {
          bShift.staffId = replacement.q.id;
          work.shifts.find((s) => s.id === stranded.id).staffId = p.id;
          return {
            staff_id: p.id, name: p.name, hours_after: after.hours_after,
            caveats: after.warnings.map((w) => w.message),
            moved: { shift_id: bShift.id, label: bShift.label, day: DAYS[bShift.day], staff_id: replacement.q.id, name: replacement.q.name },
          };
        }
      }
      bShift.staffId = p.id; // restore
    }
  }
  return null;
}

/** Best swap candidates to move a shift off someone (used by suggest_swaps). */
export function findSwaps(state, shift, { limit = 5 } = {}) {
  const out = [];
  for (const p of state.staff) {
    if (p.id === shift.staffId) continue;
    const ev = evaluateAssignment(state, shift, p, { ignoreShiftId: null });
    out.push({
      staff_id: p.id, name: p.name, eligible: ev.ok,
      hours_after: ev.hours_after, max_hours: p.maxHours,
      cost_delta: round2(shiftHours(shift) * (p.rate - (getStaff(state, shift.staffId)?.rate ?? 0))),
      blockers: ev.blockers.map((b) => b.message),
      caveats: ev.warnings.map((w) => w.message),
    });
  }
  return out.sort((a, b) => (b.eligible - a.eligible) || (a.hours_after / a.max_hours - b.hours_after / b.max_hours))
    .slice(0, limit);
}

/* -------------------------------------------------------------- exports ----- */

export function toCSV(state) {
  const rows = [['date', 'day', 'shift_id', 'label', 'role', 'start', 'end', 'hours', 'staff', 'rate', 'cost']];
  for (const s of state.shifts) {
    const p = s.staffId ? getStaff(state, s.staffId) : null;
    rows.push([
      addDays(state.weekStart, s.day), DAYS[s.day], s.id, s.label, s.role,
      fmtHour(s.start), fmtHour(s.end), String(shiftHours(s)),
      p ? p.name : 'OPEN', p ? String(p.rate) : '', p ? String(round2(shiftHours(s) * p.rate)) : '',
    ]);
  }
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

export function toICS(state, staffId = null) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (day, hour) => {
    const d = new Date(state.weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + day);
    const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(hh)}${pad(mm)}00`;
  };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//wcrew//Roster//EN', 'CALSCALE:GREGORIAN'];
  for (const s of state.shifts) {
    if (!s.staffId) continue;
    if (staffId && s.staffId !== staffId) continue;
    const p = getStaff(state, s.staffId);
    lines.push('BEGIN:VEVENT', `UID:${s.id}-${state.weekStart}@wcrew`,
      `DTSTART:${stamp(s.day, s.start)}`, `DTEND:${stamp(s.day, s.end)}`,
      `SUMMARY:${s.label} · ${p?.name ?? ''}`,
      `DESCRIPTION:${ROLES[s.role]?.label ?? s.role} shift at ${state.org}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
