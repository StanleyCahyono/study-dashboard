// Study block timer and check-ins. Elapsed time and active (unpaused) time are
// recorded separately. Each action is idempotent: tapping "finish" twice
// records one result.

import { newId, update, type Data, type Outcome, type StudySession } from "./store";

export function activeSession(d: Data): StudySession | undefined {
  return d.sessions.find((s) => s.status === "running" || s.status === "paused");
}

export function activeMs(s: StudySession, now = Date.now()): number {
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  const pausedNow = s.pauseStartedAt ? Math.max(0, end - Date.parse(s.pauseStartedAt)) : 0;
  return Math.max(0, end - Date.parse(s.startedAt) - s.pausedMs - pausedNow);
}

export function startSession(taskId: string, plannedMinutes: number, now = new Date()) {
  update((d) => {
    if (activeSession(d)) return d; // one block at a time
    const s: StudySession = {
      id: newId(),
      taskId,
      plannedMinutes,
      startedAt: now.toISOString(),
      endedAt: null,
      pausedMs: 0,
      pauseStartedAt: null,
      status: "running",
      partial: false,
      activeMinutes: null,
      checkin: null,
    };
    return { ...d, sessions: [...d.sessions, s] };
  });
}

function patchSession(id: string, fn: (s: StudySession, d: Data) => StudySession | null) {
  update((d) => {
    const s = d.sessions.find((x) => x.id === id);
    if (!s) return d;
    const next = fn(s, d);
    if (!next) return d;
    return { ...d, sessions: d.sessions.map((x) => (x.id === id ? next : x)) };
  });
}

export function pauseSession(id: string, now = new Date()) {
  patchSession(id, (s) => (s.status === "running" ? { ...s, status: "paused", pauseStartedAt: now.toISOString() } : null));
}

export function resumeSession(id: string, now = new Date()) {
  patchSession(id, (s) =>
    s.status === "paused" && s.pauseStartedAt ? { ...s, status: "running", pausedMs: s.pausedMs + (now.getTime() - Date.parse(s.pauseStartedAt)), pauseStartedAt: null } : null,
  );
}

/**
 * End the block. `taskDone` marks the task finished; otherwise the block is
 * recorded as partial progress. Adds the active minutes to the task.
 */
export function finishSession(id: string, taskDone: boolean, now = new Date()) {
  update((d) => {
    const s = d.sessions.find((x) => x.id === id);
    if (!s || (s.status !== "running" && s.status !== "paused")) return d; // already finished
    const ended: StudySession = { ...s, endedAt: now.toISOString(), status: "done", partial: !taskDone };
    const mins = Math.round(activeMs(ended, now.getTime()) / 60000);
    ended.activeMinutes = mins;
    if (ended.pauseStartedAt) {
      ended.pausedMs += now.getTime() - Date.parse(ended.pauseStartedAt);
      ended.pauseStartedAt = null;
    }
    return {
      ...d,
      sessions: d.sessions.map((x) => (x.id === id ? ended : x)),
      tasks: d.tasks.map((t) =>
        t.id === s.taskId ? { ...t, spentMinutes: t.spentMinutes + mins, done: taskDone ? true : t.done, doneAt: taskDone ? now.toISOString() : t.doneAt } : t,
      ),
    };
  });
}

export function cancelSession(id: string, now = new Date()) {
  patchSession(id, (s) => (s.status === "running" || s.status === "paused" ? { ...s, status: "cancelled", endedAt: now.toISOString() } : null));
}

export type CheckinAnswer = { outcome: Outcome | null; actualMinutes: number | null; focus: number | null; confidence: number | null; blocker: string };

/** Saves the check-in once. A corrected "actual minutes" replaces the timer's count. */
export function answerCheckin(id: string, a: CheckinAnswer, now = new Date()) {
  update((d) => {
    const s = d.sessions.find((x) => x.id === id);
    if (!s || s.status !== "done" || s.checkin) return d;
    const delta = a.actualMinutes != null && s.activeMinutes != null ? a.actualMinutes - s.activeMinutes : 0;
    return {
      ...d,
      sessions: d.sessions.map((x) => (x.id === id ? { ...x, checkin: { ...a, answeredAt: now.toISOString() } } : x)),
      tasks: delta ? d.tasks.map((t) => (t.id === s.taskId ? { ...t, spentMinutes: Math.max(0, t.spentMinutes + delta) } : t)) : d.tasks,
    };
  });
}

/** Finished blocks from the last 2 days still waiting for a check-in (unanswered = missing, not failure). */
export function pendingCheckins(d: Data, now = Date.now()): StudySession[] {
  return d.sessions.filter((s) => s.status === "done" && !s.checkin && s.endedAt && now - Date.parse(s.endedAt) < 2 * 24 * 3600 * 1000);
}

/** "Not now": keeps it unanswered but hides it (recorded as skipped, without an outcome). */
export function skipCheckin(id: string, now = new Date()) {
  answerCheckin(id, { outcome: null, actualMinutes: null, focus: null, confidence: null, blocker: "" }, now);
}
