// Learns how long tasks really take compared with the estimate.
//
// Uses only finished tasks that had an estimate and logged study time, after
// the last reset. ratio = logged minutes / original estimate. The median is
// shrunk toward 1.0 when there are few samples, and capped to 0.5–2.0.

import type { Data, Task } from "./store";

export const MIN_SAMPLES = 3;

export type Pace = { factor: number; median: number | null; n: number; byKind: Record<string, { factor: number; n: number }>; note: string };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function shrink(ratios: number[]): number {
  if (!ratios.length) return 1;
  const med = median(ratios);
  const n = ratios.length;
  const f = 1 + (med - 1) * (n / (n + MIN_SAMPLES));
  return Math.round(Math.min(2, Math.max(0.5, f)) * 100) / 100;
}

export function paceSamples(data: Data): Task[] {
  return data.tasks.filter(
    (t) => t.done && t.doneAt && (t.originalEstimate ?? 0) > 0 && t.spentMinutes > 0 && t.assignee === "me" && (!data.paceResetAt || t.doneAt > data.paceResetAt),
  );
}

export function computePace(data: Data): Pace {
  const samples = paceSamples(data);
  const ratios = samples.map((t) => t.spentMinutes / t.originalEstimate!);
  const byKind: Pace["byKind"] = {};
  for (const kind of new Set(samples.map((t) => t.kind))) {
    const r = samples.filter((t) => t.kind === kind).map((t) => t.spentMinutes / t.originalEstimate!);
    if (r.length >= MIN_SAMPLES) byKind[kind] = { factor: shrink(r), n: r.length };
  }
  if (ratios.length < MIN_SAMPLES) {
    return { factor: 1, median: ratios.length ? median(ratios) : null, n: ratios.length, byKind, note: `Not enough finished tasks yet (${ratios.length} of ${MIN_SAMPLES}); estimates are used as entered.` };
  }
  const factor = shrink(ratios);
  return {
    factor,
    median: Math.round(median(ratios) * 100) / 100,
    n: ratios.length,
    byKind,
    note: `From ${ratios.length} finished tasks you take about ${Math.round(factor * 100)}% of your estimates (capped 50–200%).`,
  };
}

export function factorFor(p: Pace, t: Task): number {
  return p.byKind[t.kind]?.factor ?? p.factor;
}
