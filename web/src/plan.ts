// Deterministic study planner. Same inputs → same plan.
//
// Units: all durations are minutes; all instants are milliseconds since epoch.
//
// Hard constraints (never broken): sleep window, class meetings and fixed
// commitments (each padded by the buffer), dependencies (a task starts only
// after what it depends on is done or handed off), daily cap.
// Priorities (configurable, only reorder within the hard constraints):
//   1. Deadline: earliest effective deadline first (EDF). The effective deadline
//      is the earliest of: due date, the task's own handoff, and the deadline of
//      anything that depends on it.
//   2. Importance and grade weight move a deadline earlier by a bounded amount
//      (up to 12 h for importance, up to 12 h for grade weight). If this makes
//      anything miss a deadline that strict EDF would meet, strict EDF is used.
//   3. Ties: higher importance, then course code, then task id.
// Unknown grade weights are never treated as zero: they use ASSUMED_WEIGHT and
// are labelled as assumed.

import { courseCode, dayKey, type Data, type Task } from "./store";
import { itemWeight } from "./grades";
import { computePace, factorFor, type Pace } from "./pace";

export const MIN = 60_000;
export const HORIZON_DAYS = 14;
export const UNKNOWN_ESTIMATE = 60;
export const ASSUMED_WEIGHT = 3; // percent of a course grade, when unknown
const MIN_FRAGMENT = 10;

export type Interval = { start: number; end: number };
export type Busy = Interval & { label: string; kind: "sleep" | "class" | "commitment" | "session" | "whatif"; realStart?: number; realEnd?: number };
export type Block = { taskId: string; start: number; end: number };

export type PlanTask = {
  task: Task;
  course: string;
  remaining: number;
  low: number;
  high: number;
  estimateUnknown: boolean;
  factor: number;
  effectiveDue: number | null;
  earliest: number;
  waitingOn: string | null; // reason it can't start yet
  scheduled: number;
  missing: number;
  slack: number | null;
  latestStart: number | null;
  firstBlock: number | null;
  weight: number | null;
  weightAssumed: boolean;
  orderKey: number;
};

export type NextAction = {
  pt: PlanTask;
  minutes: number;
  reasons: string[];
  changes: string[];
  conflict: string | null;
};

export type DayCapacity = { day: string; date: number; free: number; planned: number; byCourse: Record<string, number> };

export type Plan = {
  now: number;
  free: Interval[];
  busy: Busy[];
  blocks: Block[];
  tasks: PlanTask[];
  atRisk: PlanTask[];
  next: NextAction | null;
  alternatives: PlanTask[];
  capacity: DayCapacity[];
  pace: Pace;
  strictEdfUsed: boolean;
};

export type PlanOptions = { extraBusy?: Busy[]; forceFirst?: string; energy?: "deep" | "normal" | "light" };

function hm(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h || 0, m || 0];
}

function atLocal(day: Date, hhmm: string, addDays = 0): number {
  const [h, m] = hm(hhmm);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + addDays, h, m, 0, 0).getTime();
}

function startOfDay(t: number): Date {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function busyIntervals(data: Data, from: number, to: number): Busy[] {
  const out: Busy[] = [];
  const s = data.settings;
  const buf = s.bufferMinutes * MIN;
  const first = startOfDay(from);
  const days = Math.ceil((to - first.getTime()) / (24 * 60 * MIN)) + 1;
  for (let i = -1; i <= days; i++) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    const sleepStart = atLocal(day, s.sleepStart);
    let sleepEnd = atLocal(day, s.sleepEnd);
    if (sleepEnd <= sleepStart) sleepEnd = atLocal(day, s.sleepEnd, 1);
    out.push({ start: sleepStart, end: sleepEnd, label: "Sleep", kind: "sleep" });
    const wd = (day.getDay() + 6) % 7;
    for (const m of data.meetings) {
      if (m.weekday !== wd) continue;
      const c = courseCode(data, m.courseId) ?? "Class";
      out.push({ start: atLocal(day, m.start) - buf, end: atLocal(day, m.end) + buf, realStart: atLocal(day, m.start), realEnd: atLocal(day, m.end), label: `${c} ${m.kind}`, kind: "class" });
    }
  }
  for (const c of data.commitments) {
    const a = Date.parse(c.start);
    const b = Date.parse(c.end);
    if (b >= from && a <= to) out.push({ start: a - buf, end: b + buf, realStart: a, realEnd: b, label: c.title, kind: "commitment" });
  }
  // Study blocks you moved yourself in Google Calendar are kept as you placed them.
  for (const pb of data.gplan?.published ?? []) {
    if (pb.state !== "user_moved") continue;
    const a = Date.parse(pb.start);
    const b = Date.parse(pb.end);
    if (b >= from && a <= to) out.push({ start: a, end: b, label: `${pb.title} (moved by you)`, kind: "commitment" });
  }
  for (const ses of data.sessions) {
    if (ses.status === "running" || ses.status === "paused") {
      const a = Date.parse(ses.startedAt);
      out.push({ start: a, end: Math.max(from, a + ses.plannedMinutes * MIN), label: "Current block", kind: "session" });
    }
  }
  return out.filter((b) => b.end > from && b.start < to).sort((a, b) => a.start - b.start);
}

export function subtract(range: Interval, busy: Interval[]): Interval[] {
  let free: Interval[] = [range];
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of free) {
      if (b.end <= f.start || b.start >= f.end) next.push(f);
      else {
        if (b.start > f.start) next.push({ start: f.start, end: b.start });
        if (b.end < f.end) next.push({ start: b.end, end: f.end });
      }
    }
    free = next;
  }
  return free.filter((f) => f.end - f.start >= MIN_FRAGMENT * MIN);
}

function minutesIn(free: Interval[], from: number, to: number): number {
  let sum = 0;
  for (const f of free) sum += Math.max(0, Math.min(f.end, to) - Math.max(f.start, from));
  return Math.floor(sum / MIN);
}

/** Latest time to start so that `need` minutes of free time remain before `due`. */
function latestStartFor(free: Interval[], due: number, need: number): number | null {
  let left = need * MIN;
  for (let i = free.length - 1; i >= 0; i--) {
    const f = free[i];
    if (f.start >= due) continue;
    const end = Math.min(f.end, due);
    const len = end - f.start;
    if (len >= left) return end - left;
    left -= len;
  }
  return left <= 0 ? due : null;
}

function taskWeight(data: Data, t: Task): { weight: number | null; assumed: boolean } {
  if (t.gradeItemId) {
    const course = data.courses.find((c) => c.id === t.courseId);
    if (course) {
      const w = itemWeight(course, data.gradeItems, t.gradeItemId);
      if (w != null) return { weight: w, assumed: false };
    }
  }
  return { weight: null, assumed: true };
}

function estimate(t: Task, pace: Pace) {
  const typical = t.estMinutes ?? (t.estLow != null && t.estHigh != null ? Math.round((t.estLow + t.estHigh) / 2) : null);
  const f = factorFor(pace, t);
  const base = typical ?? UNKNOWN_ESTIMATE;
  const remaining = Math.max(0, Math.round(base * f) - t.spentMinutes);
  const low = Math.max(0, Math.round((t.estLow ?? base) * f) - t.spentMinutes);
  const high = Math.max(remaining, Math.round((t.estHigh ?? base) * f) - t.spentMinutes);
  return { remaining, low: Math.min(low, remaining), high, unknown: typical == null, factor: f };
}

type Prep = PlanTask & { deps: Task[] };

function prepare(data: Data, now: number, pace: Pace): Prep[] {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const mine = data.tasks.filter((t) => !t.done && t.assignee !== "teammate");
  const prep: Prep[] = mine.map((t) => {
    const e = estimate(t, pace);
    // Minutes already placed by you (moved blocks in Google Calendar) count as planned.
    const placed = (data.gplan?.published ?? [])
      .filter((pb) => pb.state === "user_moved" && pb.taskId === t.id && Date.parse(pb.end) > now)
      .reduce((sum, pb) => sum + Math.round((Date.parse(pb.end) - Date.parse(pb.start)) / MIN), 0);
    e.remaining = Math.max(0, e.remaining - placed);
    const due = t.due ? Date.parse(t.due) : null;
    const handoff = t.handoff ? Date.parse(t.handoff) : null;
    const w = taskWeight(data, t);
    return {
      task: t,
      course: courseCode(data, t.courseId) ?? "No course",
      remaining: e.remaining,
      low: e.low,
      high: e.high,
      estimateUnknown: e.unknown,
      factor: e.factor,
      effectiveDue: [due, handoff].filter((x): x is number => x != null).reduce<number | null>((a, b) => (a == null ? b : Math.min(a, b)), null),
      earliest: now,
      waitingOn: null,
      scheduled: 0,
      missing: 0,
      slack: null,
      latestStart: null,
      firstBlock: null,
      weight: w.weight,
      weightAssumed: w.assumed,
      orderKey: 0,
      deps: t.dependsOn.map((id) => byId.get(id)).filter((x): x is Task => !!x),
    };
  });
  // Deadlines flow backwards through dependencies (a few passes are enough for real projects).
  const byTask = new Map(prep.map((p) => [p.task.id, p]));
  for (let pass = 0; pass < 5; pass++) {
    for (const p of prep) {
      if (p.effectiveDue == null) continue;
      for (const d of p.deps) {
        const dp = byTask.get(d.id);
        if (dp && (dp.effectiveDue == null || dp.effectiveDue > p.effectiveDue)) dp.effectiveDue = p.effectiveDue;
      }
    }
  }
  // Waiting on teammates or snoozed.
  for (const p of prep) {
    for (const d of p.deps) {
      if (d.done) continue;
      if (d.assignee === "teammate") {
        const h = d.handoff ? Date.parse(d.handoff) : null;
        if (h == null) p.waitingOn = `Waiting for a teammate: “${d.title}” (no handoff date)`;
        else if (h > now) {
          p.earliest = Math.max(p.earliest, h);
          p.waitingOn = `Waiting for a teammate: “${d.title}” (handoff ${fmt(h)})`;
        } else p.waitingOn = `Teammate handoff for “${d.title}” is late`;
      }
    }
    if (p.task.snoozedUntil && Date.parse(p.task.snoozedUntil) > now) p.earliest = Math.max(p.earliest, Date.parse(p.task.snoozedUntil));
  }
  return prep;
}

function order(prep: Prep[], now: number, strict: boolean): Prep[] {
  const key = (p: Prep) => {
    if (p.effectiveDue == null) return Number.MAX_SAFE_INTEGER - (strict ? 0 : p.task.importance * 1e6);
    if (strict) return p.effectiveDue;
    const imp = (p.task.importance - 2) * 12 * 60 * MIN; // ±12 h
    const w = Math.min(12, ((p.weight ?? ASSUMED_WEIGHT) / 25) * 12) * 60 * MIN; // up to 12 h at 25% of a grade
    return Math.max(now, p.effectiveDue - imp - w);
  };
  for (const p of prep) p.orderKey = key(p);
  const remaining = [...prep];
  const out: Prep[] = [];
  const placed = new Set<string>();
  while (remaining.length) {
    const ready = remaining.filter((p) => p.deps.every((d) => d.done || d.assignee === "teammate" || placed.has(d.id) || !remaining.some((r) => r.task.id === d.id)));
    const pool = ready.length ? ready : remaining; // cycle guard
    pool.sort((a, b) => a.orderKey - b.orderKey || b.task.importance - a.task.importance || a.course.localeCompare(b.course) || a.task.id.localeCompare(b.task.id));
    const pick = pool[0];
    out.push(pick);
    placed.add(pick.task.id);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return out;
}

function schedule(data: Data, ordered: Prep[], free: Interval[], now: number, horizonEnd: number): { blocks: Block[]; tasks: Prep[] } {
  const s = data.settings;
  const pool = free.map((f) => ({ ...f }));
  const blocks: Block[] = [];
  const perDay = new Map<string, number>();
  const endOf = new Map<string, number>();
  const result = ordered.map((p) => ({ ...p }));
  const maxBlock = s.preferLongBlocks ? s.maxBlock : Math.min(50, s.maxBlock);
  for (const p of result) {
    if (p.waitingOn && p.waitingOn.includes("no handoff date")) {
      p.missing = 0;
      continue;
    }
    let left = p.remaining;
    let earliest = p.earliest;
    for (const d of p.deps) if (endOf.has(d.id)) earliest = Math.max(earliest, endOf.get(d.id)!);
    const deadline = p.effectiveDue ?? horizonEnd;
    const pause = s.bufferMinutes * MIN; // short break between back-to-back blocks
    for (let i = 0; i < pool.length && left > 0; i++) {
      const f = pool[i];
      const hi = Math.min(f.end, deadline);
      const lo = Math.max(f.start, earliest, now);
      if (lo >= hi) continue;
      let cursor = lo;
      let firstTaken: number | null = null;
      let lastEnd = lo;
      while (left > 0 && cursor < hi) {
        const dk = dayKey(new Date(cursor));
        const used = perDay.get(dk) ?? 0;
        const capLeft = s.dailyCapMinutes == null ? Infinity : s.dailyCapMinutes - used;
        const need = Math.min(s.minBlock, left);
        const room = Math.floor((hi - cursor) / MIN);
        if (capLeft < need || room < need) break;
        const len = Math.min(left, maxBlock, capLeft, room);
        blocks.push({ taskId: p.task.id, start: cursor, end: cursor + len * MIN });
        if (p.firstBlock == null) p.firstBlock = cursor;
        if (firstTaken == null) firstTaken = cursor;
        perDay.set(dk, used + len);
        left -= len;
        lastEnd = cursor + len * MIN;
        endOf.set(p.task.id, lastEnd);
        cursor = lastEnd + pause;
      }
      if (firstTaken != null) {
        // Give back what wasn't used: the part before the first block and after the last one.
        const pieces: Interval[] = [];
        if (firstTaken - f.start >= MIN_FRAGMENT * MIN) pieces.push({ start: f.start, end: firstTaken });
        if (f.end - lastEnd >= MIN_FRAGMENT * MIN) pieces.push({ start: lastEnd, end: f.end });
        pool.splice(i, 1, ...pieces);
        i += pieces.length - 1;
      }
    }
    p.scheduled = p.remaining - left;
    p.missing = p.effectiveDue == null ? 0 : left;
  }
  blocks.sort((a, b) => a.start - b.start);
  return { blocks, tasks: result };
}

function computeSlack(tasks: Prep[], free: Interval[], now: number) {
  const dated = tasks.filter((p) => p.effectiveDue != null).sort((a, b) => a.effectiveDue! - b.effectiveDue!);
  let cumulative = 0;
  for (const p of dated) {
    cumulative += p.remaining;
    p.slack = minutesIn(free, now, p.effectiveDue!) - cumulative;
    p.latestStart = latestStartFor(free, p.effectiveDue!, cumulative);
  }
}

function fitsDevice(data: Data, t: Task): boolean {
  return data.settings.device === "computer" || t.needs === "any";
}

const fmt = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

function explain(data: Data, plan: Omit<Plan, "next" | "alternatives">, pt: PlanTask, runnerUp: PlanTask | undefined, energy?: string): NextAction {
  const s = data.settings;
  const reasons: string[] = [];
  const changes: string[] = [];
  if (pt.effectiveDue != null) {
    const due = pt.task.due ? Date.parse(pt.task.due) : null;
    reasons.push(`Due ${fmt(pt.effectiveDue)}${due != null && due !== pt.effectiveDue ? " (earlier than the due date because of a handoff or a later step that depends on it)" : ""}.`);
  } else reasons.push("No due date; scheduled after dated work.");
  reasons.push(
    `About ${pt.remaining} min left${pt.low !== pt.high ? ` (range ${pt.low}–${pt.high})` : ""}${pt.estimateUnknown ? `; estimate unknown, ${UNKNOWN_ESTIMATE} min assumed` : ""}${pt.factor !== 1 ? `; pace-adjusted ×${pt.factor}` : ""}.`,
  );
  if (pt.missing > 0) reasons.push(`At risk: ${pt.missing} min more than your free time before the deadline.`);
  else if (pt.slack != null) reasons.push(`${pt.slack} min of spare free time before it’s due, counting everything due earlier.`);
  if (pt.latestStart != null) reasons.push(`Latest sensible start: ${pt.latestStart <= plan.now ? "now" : fmt(pt.latestStart)}.`);
  reasons.push(pt.weight != null ? `Worth ${pt.weight}% of ${pt.course}.` : `Grade weight unknown (assumed ${ASSUMED_WEIGHT}%, not zero).`);
  if (pt.task.importance !== 2) reasons.push(`You marked it ${pt.task.importance === 3 ? "high" : "low"} importance.`);
  if (s.device === "phone" && pt.task.needs === "any") reasons.push("Can be done on your phone.");
  let conflict: string | null = null;
  if (energy === "light" && pt.task.energy === "deep") {
    conflict =
      pt.missing > 0 || (pt.slack ?? 1e9) < 120
        ? `You said you prefer lighter work, but “${pt.task.title}” needs focus and its deadline is tight. Decide: do a shorter 25-minute block now, or swap and accept less spare time.`
        : null;
  }
  if (runnerUp) {
    const a = pt.effectiveDue ?? Infinity;
    const b = runnerUp.effectiveDue ?? Infinity;
    const why = a < b ? "it’s due later" : runnerUp.task.importance < pt.task.importance ? "it’s less important" : "it ranks lower on grade weight or ties";
    changes.push(`Next in line: “${runnerUp.task.title}” (${why}).`);
    if (b > a && b !== Infinity) changes.push(`If “${runnerUp.task.title}” were due before ${fmt(a)}, it would come first.`);
  }
  changes.push("Changing the estimate, deadline, importance or your free time (sleep, classes, commitments) changes this.");
  if (pt.estimateUnknown) changes.push("Adding an estimate would make the plan more accurate.");
  const freeNow = plan.free.find((f) => f.end > plan.now && f.start <= plan.now);
  const room = freeNow ? Math.floor((freeNow.end - plan.now) / MIN) : s.maxBlock;
  let minutes = Math.max(5, Math.min(pt.remaining, s.preferLongBlocks ? s.maxBlock : 50, room));
  if (energy === "light") minutes = Math.min(minutes, 25);
  return { pt, minutes, reasons, changes, conflict };
}

export function buildPlan(data: Data, nowDate = new Date(), opts: PlanOptions = {}): Plan {
  const now = nowDate.getTime();
  const horizonEnd = now + HORIZON_DAYS * 24 * 60 * MIN;
  const pace = computePace(data);
  const busy = [...busyIntervals(data, now, horizonEnd), ...(opts.extraBusy ?? [])].sort((a, b) => a.start - b.start);
  const free = subtract({ start: now, end: horizonEnd }, busy);
  const prep = prepare(data, now, pace);

  const run = (strict: boolean) => {
    let ordered = order(prep, now, strict);
    if (opts.forceFirst) {
      const i = ordered.findIndex((p) => p.task.id === opts.forceFirst);
      if (i > 0) ordered = [ordered[i], ...ordered.slice(0, i), ...ordered.slice(i + 1)];
    }
    return schedule(data, ordered, free, now, horizonEnd);
  };
  let res = run(false);
  let strictEdfUsed = false;
  const missing = (r: typeof res) => r.tasks.reduce((s, p) => s + p.missing, 0);
  if (!opts.forceFirst && missing(res) > 0) {
    const strict = run(true);
    if (missing(strict) < missing(res)) {
      res = strict;
      strictEdfUsed = true;
    }
  }
  computeSlack(res.tasks, free, now);
  const tasks: PlanTask[] = res.tasks.map(({ deps: _d, ...p }) => p);
  const atRisk = tasks.filter((p) => p.missing > 0);

  const capacity: DayCapacity[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + i);
    const a = Math.max(now, day.getTime());
    const b = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const byCourse: Record<string, number> = {};
    let planned = 0;
    for (const bl of res.blocks) {
      const ov = Math.max(0, Math.min(bl.end, b) - Math.max(bl.start, a)) / MIN;
      if (!ov) continue;
      planned += ov;
      const c = tasks.find((t) => t.task.id === bl.taskId)?.course ?? "?";
      byCourse[c] = (byCourse[c] ?? 0) + ov;
    }
    capacity.push({ day: day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), date: day.getTime(), free: minutesIn(free, a, b), planned: Math.round(planned), byCourse });
  }

  const base = { now, free, busy, blocks: res.blocks, tasks, atRisk, capacity, pace, strictEdfUsed };
  // Next action: the earliest planned block whose task can start now on this device.
  const startable = (p: PlanTask) => p.remaining > 0 && p.earliest <= now && !p.waitingOn?.includes("no handoff") && fitsDevice(data, p.task);
  const blockOrder = [...new Set(res.blocks.map((b) => b.taskId))];
  let candidates = blockOrder.map((id) => tasks.find((t) => t.task.id === id)!).filter(startable);
  const unscheduled = tasks.filter((p) => startable(p) && !blockOrder.includes(p.task.id));
  candidates = [...candidates, ...unscheduled];
  if (opts.energy === "light") {
    const first = candidates[0];
    const urgent = first && (first.missing > 0 || (first.slack ?? 1e9) < 120);
    if (first && first.task.energy === "deep" && !urgent) {
      const lighter = candidates.findIndex((c) => c.task.energy !== "deep" && (c.missing === 0 || c.missing <= first.missing));
      if (lighter > 0) candidates = [candidates[lighter], ...candidates.filter((_, i) => i !== lighter)];
    }
  }
  const next = candidates[0] ? explain(data, base, candidates[0], candidates[1], opts.energy) : null;
  if (next && opts.energy === "light" && candidates[0] !== blockOrder.map((id) => tasks.find((t) => t.task.id === id)).find(Boolean)) {
    next.reasons.push("Chosen because you asked for lighter work and nothing urgent needs focus right now.");
  }
  return { ...base, next, alternatives: candidates.slice(1, 4) };
}

/** Compare against a variant: which tasks lose minutes. */
export type Delta = { title: string; before: number; after: number };
export function missingDelta(a: Plan, b: Plan): Delta[] {
  const out: Delta[] = [];
  for (const t of b.tasks) {
    const before = a.tasks.find((x) => x.task.id === t.task.id)?.missing ?? 0;
    if (t.missing !== before) out.push({ title: t.task.title, before, after: t.missing });
  }
  return out;
}

/** "If I have N fewer minutes today": block the first N free minutes from now. */
export function lessTimeToday(data: Data, nowDate: Date, minutes: number): { plan: Plan; delta: Delta[] } {
  const base = buildPlan(data, nowDate);
  const extra: Busy[] = [];
  let left = minutes * MIN;
  const endOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1).getTime();
  for (const f of base.free) {
    if (left <= 0 || f.start >= endOfDay) break;
    const len = Math.min(left, Math.min(f.end, endOfDay) - f.start);
    extra.push({ start: f.start, end: f.start + len, label: "What-if", kind: "whatif" });
    left -= len;
  }
  const plan = buildPlan(data, nowDate, { extraBusy: extra });
  return { plan, delta: missingDelta(base, plan) };
}

/** "Prioritize this": schedule one task before everything else. */
export function prioritize(data: Data, nowDate: Date, taskId: string): { plan: Plan; delta: Delta[] } {
  const base = buildPlan(data, nowDate);
  const plan = buildPlan(data, nowDate, { forceFirst: taskId });
  return { plan, delta: missingDelta(base, plan) };
}

/** iCalendar export of planned blocks (for any calendar app). */
export function planToIcs(data: Data, plan: Plan): string {
  const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Study planner//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Study Plan"];
  for (const b of plan.blocks) {
    const t = data.tasks.find((x) => x.id === b.taskId);
    if (!t) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:study-${b.taskId}-${b.start}@study.local`,
      `DTSTAMP:${stamp(plan.now)}`,
      `DTSTART:${stamp(b.start)}`,
      `DTEND:${stamp(b.end)}`,
      `SUMMARY:${esc(`Study: ${t.title}`)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
