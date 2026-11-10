import { dayKey, type Habit } from "./store";

export function isScheduled(h: Habit, date: Date): boolean {
  return !h.paused && h.weekdays.includes((date.getDay() + 6) % 7);
}

export function doneOn(h: Habit, date: Date): boolean {
  return (h.log[dayKey(date)] ?? 0) >= h.target;
}

/** Consecutive scheduled days met, allowing `grace` missed days. Today doesn't break it until it's over. */
export function streak(h: Habit, today: Date, grace = 1): number {
  let count = 0;
  let misses = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (d.getTime() < new Date(h.createdAt).setHours(0, 0, 0, 0)) break;
    if (!isScheduled(h, d)) continue;
    if (doneOn(h, d)) count++;
    else if (i === 0) continue;
    else if (++misses > grace) break;
  }
  return count;
}

/** Completion rate for each of the last `weeks` weeks (oldest first); null when nothing was scheduled. */
export function weeklyRates(h: Habit, today: Date, weeks = 4): (number | null)[] {
  const out: (number | null)[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    let due = 0;
    let met = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - w * 7 - i);
      if (d > today || d.getTime() < new Date(h.createdAt).setHours(0, 0, 0, 0) || !isScheduled(h, d)) continue;
      due++;
      if (doneOn(h, d)) met++;
    }
    out.push(due ? met / due : null);
  }
  return out;
}
