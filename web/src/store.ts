// All study data lives in this browser's localStorage on this device only.
// Nothing is uploaded anywhere: the page's Content-Security-Policy blocks
// network requests to other sites.

import { useCallback, useSyncExternalStore } from "react";

export type AiUse = "unknown" | "metadata" | "local" | "external";
export type CoverageKey = "dueDates" | "meetings" | "grades" | "syllabus";

export type GradeGroup = { id: string; name: string; weight: number | null; dropLowest: number };
export type Grading = { mode: "weighted" | "points"; groups: GradeGroup[]; rulesConfirmed: boolean; ruleSource: string };

export type Course = {
  id: string;
  code: string;
  title: string;
  target: number | null; // target final grade, percent
  importance: 1 | 2 | 3;
  grading: Grading;
  aiUse: AiUse;
  aiPolicyNote: string;
  coverage: Record<CoverageKey, boolean>;
};

export type Meeting = {
  id: string;
  courseId: string;
  kind: string; // lecture, section, lab…
  weekday: number; // Monday = 0 … Sunday = 6
  start: string; // "HH:MM" local time
  end: string;
  location: string;
};

/** A one-off fixed event (exam sitting, work shift, appointment). Blocks study time. */
export type Commitment = { id: string; title: string; start: string; end: string; courseId: string | null; kind: "exam" | "fixed"; source: "manual" | "ics"; uid?: string };

export type TaskKind = "reading" | "problem set" | "writing" | "project" | "exam prep" | "other";

export type Task = {
  id: string;
  courseId: string | null;
  title: string;
  notes: string;
  due: string | null; // ISO instant, or null if unknown
  allDay: boolean; // due date known but not the time
  kind: TaskKind;
  estMinutes: number | null; // typical estimate
  estLow: number | null;
  estHigh: number | null;
  originalEstimate: number | null; // first estimate, kept for learning
  spentMinutes: number;
  importance: 1 | 2 | 3;
  done: boolean;
  doneAt: string | null;
  source: "manual" | "ics" | "demo" | "email";
  uid?: string;
  parentId: string | null; // project this belongs to
  dependsOn: string[];
  assignee: "me" | "teammate" | "unassigned";
  handoff: string | null; // latest handoff to/from the group
  needs: "any" | "computer" | "campus";
  energy: "deep" | "normal" | "light";
  snoozedUntil: string | null;
  gradeItemId: string | null;
  evidence: string[]; // short source quotes
};

export type GradeStatus = "pending" | "graded" | "missing" | "excused";
export type GradeItem = {
  id: string;
  courseId: string;
  groupId: string | null;
  name: string;
  possible: number;
  score: number | null;
  status: GradeStatus;
  extraCredit: boolean;
  gradedAt: string | null;
};

export type Outcome = "early" | "on_time" | "longer" | "other";
export type StudySession = {
  id: string;
  taskId: string;
  plannedMinutes: number;
  startedAt: string;
  endedAt: string | null;
  pausedMs: number;
  pauseStartedAt: string | null;
  status: "running" | "paused" | "done" | "cancelled";
  partial: boolean;
  activeMinutes: number | null;
  checkin: null | { answeredAt: string; outcome: Outcome | null; actualMinutes: number | null; focus: number | null; confidence: number | null; blocker: string };
};

export type Habit = { id: string; name: string; weekdays: number[]; target: number; unit: string; paused: boolean; log: Record<string, number>; createdAt: string };
export type DayLog = { energy?: "deep" | "normal" | "light"; screenMinutes?: number | null; screenNote?: string };
export type Note = { id: string; courseId: string; title: string; body: string; source: string; updatedAt: string };
export type InboxItem = {
  id: string;
  createdAt: string;
  title: string;
  due: string | null;
  allDay: boolean;
  courseId: string | null;
  quote: string;
  sender: string;
  status: "pending" | "accepted" | "dismissed" | "duplicate";
  taskId: string | null;
};

export type Settings = {
  sleepStart: string; // "23:30"
  sleepEnd: string; // "07:30"
  bufferMinutes: number;
  minBlock: number;
  maxBlock: number;
  preferLongBlocks: boolean;
  dailyCapMinutes: number | null;
  device: "computer" | "phone";
  quietStart: string;
  quietEnd: string;
  reminders: boolean;
};

export type Data = {
  v: 2;
  courses: Course[];
  meetings: Meeting[];
  commitments: Commitment[];
  tasks: Task[];
  gradeItems: GradeItem[];
  sessions: StudySession[];
  habits: Habit[];
  days: Record<string, DayLog>;
  notes: Note[];
  inbox: InboxItem[];
  settings: Settings;
  paceResetAt: string | null;
  demo: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  sleepStart: "23:30",
  sleepEnd: "07:30",
  bufferMinutes: 10,
  minBlock: 25,
  maxBlock: 90,
  preferLongBlocks: true,
  dailyCapMinutes: 360,
  device: "phone",
  quietStart: "22:30",
  quietEnd: "08:00",
  reminders: true,
};

export function emptyData(): Data {
  return {
    v: 2,
    courses: [],
    meetings: [],
    commitments: [],
    tasks: [],
    gradeItems: [],
    sessions: [],
    habits: [],
    days: {},
    notes: [],
    inbox: [],
    settings: { ...DEFAULT_SETTINGS },
    paceResetAt: null,
    demo: false,
  };
}

export function newCourse(code: string, title = "", id = newId()): Course {
  return {
    id,
    code,
    title,
    target: null,
    importance: 2,
    grading: { mode: "weighted", groups: [], rulesConfirmed: false, ruleSource: "" },
    aiUse: "unknown",
    aiPolicyNote: "",
    coverage: { dueDates: false, meetings: false, grades: false, syllabus: false },
  };
}

export function newTask(fields: Partial<Task> & { title: string }): Task {
  return {
    id: newId(),
    courseId: null,
    notes: "",
    due: null,
    allDay: false,
    kind: "other",
    estMinutes: null,
    estLow: null,
    estHigh: null,
    originalEstimate: fields.estMinutes ?? null,
    spentMinutes: 0,
    importance: 2,
    done: false,
    doneAt: null,
    source: "manual",
    parentId: null,
    dependsOn: [],
    assignee: "me",
    handoff: null,
    needs: "any",
    energy: "normal",
    snoozedUntil: null,
    gradeItemId: null,
    evidence: [],
    ...fields,
  };
}

const KEY = "study-data-v1";

/** Accepts version 1 (first release) or 2 and returns a complete version 2 object. */
export function migrate(x: unknown): Data {
  const d = x as Record<string, unknown>;
  if (!d || (d.v !== 1 && d.v !== 2) || !Array.isArray(d.courses) || !Array.isArray(d.meetings) || !Array.isArray(d.tasks)) {
    throw new Error("This isn’t a Study backup file.");
  }
  const base = emptyData();
  const courses = (d.courses as Partial<Course>[]).map((c) => ({ ...newCourse(c.code ?? "?", c.title ?? "", c.id), ...c }) as Course);
  for (const c of courses) {
    c.grading = { ...newCourse("").grading, ...c.grading };
    c.coverage = { ...newCourse("").coverage, ...c.coverage };
  }
  const tasks = (d.tasks as Partial<Task>[]).map((t) => {
    const full = { ...newTask({ title: t.title ?? "Untitled" }), ...t } as Task;
    if (full.originalEstimate == null) full.originalEstimate = full.estMinutes;
    return full;
  });
  const arr = <T,>(k: string): T[] => (Array.isArray(d[k]) ? (d[k] as T[]) : []);
  return {
    ...base,
    courses,
    meetings: d.meetings as Meeting[],
    tasks,
    commitments: arr<Commitment>("commitments"),
    gradeItems: arr<GradeItem>("gradeItems"),
    sessions: arr<StudySession>("sessions"),
    habits: arr<Habit>("habits"),
    notes: arr<Note>("notes"),
    inbox: arr<InboxItem>("inbox"),
    days: (d.days && typeof d.days === "object" ? d.days : {}) as Record<string, DayLog>,
    settings: { ...DEFAULT_SETTINGS, ...((d.settings as Partial<Settings>) ?? {}) },
    paceResetAt: (d.paceResetAt as string | null) ?? null,
    demo: Boolean(d.demo),
  };
}

/** Kept for older callers: validate == migrate. */
export const validate = migrate;

let current: Data = load();
const listeners = new Set<() => void>();

function load(): Data {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return migrate(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

export let saveError: string | null = null;

function save(next: Data) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    saveError = null;
  } catch {
    saveError = "Couldn’t save on this device (storage full or blocked). Export a backup now.";
  }
  listeners.forEach((l) => l());
}

export function getData(): Data {
  return current;
}

export function update(fn: (d: Data) => Data) {
  save(fn(current));
}

export function replaceAll(d: Data) {
  save(d);
}

export function useData(): Data {
  const sub = useCallback((cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return useSyncExternalStore(sub, getData);
}

export function newId(): string {
  return crypto.randomUUID();
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function courseCode(d: Data, id: string | null): string | null {
  if (!id) return null;
  return d.courses.find((c) => c.id === id)?.code ?? null;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function updateTask(id: string, patch: Partial<Task>) {
  update((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}
