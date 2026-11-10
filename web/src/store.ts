// All study data lives in this browser's localStorage on this device only.
// Nothing is uploaded anywhere: the page's Content-Security-Policy blocks
// network requests to other sites.

import { useCallback, useSyncExternalStore } from "react";

export type Course = { id: string; code: string; title: string };
export type Meeting = {
  id: string;
  courseId: string;
  kind: string; // lecture, section, lab…
  weekday: number; // Monday = 0 … Sunday = 6
  start: string; // "HH:MM" local time
  end: string;
  location: string;
};
export type Task = {
  id: string;
  courseId: string | null;
  title: string;
  due: string | null; // ISO instant, or null if unknown
  allDay: boolean; // due date known but not the time
  estMinutes: number | null;
  done: boolean;
  source: "manual" | "ics" | "demo";
  uid?: string; // calendar UID, for re-imports without duplicates
};
export type Data = { v: 1; courses: Course[]; meetings: Meeting[]; tasks: Task[]; demo: boolean };

const KEY = "study-data-v1";
const EMPTY: Data = { v: 1, courses: [], meetings: [], tasks: [], demo: false };

let current: Data = load();
const listeners = new Set<() => void>();

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return validate(JSON.parse(raw));
  } catch {
    return EMPTY;
  }
}

export function validate(x: unknown): Data {
  const d = x as Partial<Data>;
  if (!d || d.v !== 1 || !Array.isArray(d.courses) || !Array.isArray(d.meetings) || !Array.isArray(d.tasks)) {
    throw new Error("This isn’t a Study backup file.");
  }
  return { v: 1, courses: d.courses, meetings: d.meetings, tasks: d.tasks, demo: Boolean(d.demo) };
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
