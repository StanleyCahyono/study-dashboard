// Minimal iCalendar (.ics) reader for files such as a Canvas calendar feed or a
// class schedule export. Runs entirely in the browser.
//
// * Weekly repeating timed events (RRULE FREQ=WEEKLY) become class meetings.
// * One-off timed events with a start AND end (an exam sitting, a shift)
//   become fixed commitments that block study time.
// * Everything else (deadlines, all-day items) becomes a task due at its start
//   (all-day = 11:59 PM, marked "time not given").
// * A course code like "AEM 1101" in the title, [brackets] or location links the course.

import { newCourse, newId, newTask, type Commitment, type Course, type Data, type Meeting, type Task } from "./store";

type Prop = { name: string; params: Record<string, string>; value: string };
export type IcsDate = { date: Date; allDay: boolean };
export type IcsEvent = { uid?: string; summary: string; start?: IcsDate; end?: IcsDate; rrule?: string; location?: string; status?: string; description?: string };

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}

export function parseIcsDate(p: Prop): IcsDate | undefined {
  const v = p.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  if (p.params.VALUE === "DATE" || h === undefined) {
    return { date: new Date(+y, +mo - 1, +d, 23, 59), allDay: true };
  }
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))), allDay: false };
  // Floating or TZID time: treated as this device's local time.
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = { summary: "" };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case "UID":
        cur.uid = p.value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescape(p.value);
        break;
      case "LOCATION":
        cur.location = unescape(p.value);
        break;
      case "DESCRIPTION":
        cur.description = unescape(p.value).slice(0, 2000);
        break;
      case "DTSTART":
        cur.start = parseIcsDate(p);
        break;
      case "DTEND":
        cur.end = parseIcsDate(p);
        break;
      case "RRULE":
        cur.rrule = p.value;
        break;
      case "STATUS":
        cur.status = p.value.trim().toUpperCase();
        break;
    }
  }
  return events;
}

export const COURSE_CODE = /\b([A-Z]{2,6})\s?(\d{4})\b/;
const DAYS: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function findOrCreateCourse(courses: Course[], text: string, onCreate?: () => void): string | null {
  const m = text.match(COURSE_CODE);
  if (!m) return null;
  const code = `${m[1]} ${m[2]}`;
  let c = courses.find((x) => x.code.replace(/\s/g, "") === code.replace(/\s/g, ""));
  if (!c) {
    c = newCourse(code);
    courses.push(c);
    onCreate?.();
  }
  return c.id;
}

export function guessKind(title: string): Task["kind"] {
  const t = title.toLowerCase();
  if (/\b(read|reading|chapter|ch\.)\b/.test(t)) return "reading";
  if (/\b(problem set|pset|homework|hw|exercise)\b/.test(t)) return "problem set";
  if (/\b(essay|paper|memo|draft|write|report)\b/.test(t)) return "writing";
  if (/\b(project|case|team|group)\b/.test(t)) return "project";
  if (/\b(prelim|exam|midterm|final|quiz|review)\b/.test(t)) return "exam prep";
  return "other";
}

export type ImportResult = {
  data: Data;
  addedTasks: number;
  updatedTasks: number;
  addedMeetings: number;
  addedCourses: number;
  addedCommitments: number;
  skipped: number;
};

export function importIcs(data: Data, text: string): ImportResult {
  const events = parseIcs(text);
  const courses: Course[] = [...data.courses];
  const meetings: Meeting[] = [...data.meetings];
  const tasks: Task[] = [...data.tasks];
  const commitments: Commitment[] = [...data.commitments];
  const res = { addedTasks: 0, updatedTasks: 0, addedMeetings: 0, addedCourses: 0, addedCommitments: 0, skipped: 0 };
  const touched = new Set<string>();
  const created = () => res.addedCourses++;

  for (const ev of events) {
    if (!ev.start || ev.status === "CANCELLED" || !ev.summary) {
      res.skipped++;
      continue;
    }
    const courseId = findOrCreateCourse(courses, ev.summary, created) ?? findOrCreateCourse(courses, ev.location ?? "", created);
    const rule = ev.rrule ? Object.fromEntries(ev.rrule.split(";").map((kv) => kv.split("=") as [string, string])) : null;
    if (rule && rule.FREQ === "WEEKLY" && !ev.start.allDay && ev.end) {
      if (!courseId) {
        res.skipped++;
        continue;
      }
      const days = rule.BYDAY ? rule.BYDAY.split(",").map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : [(ev.start.date.getDay() + 6) % 7];
      for (const weekday of days) {
        const exists = meetings.some((m) => m.courseId === courseId && m.weekday === weekday && m.start === hhmm(ev.start!.date));
        if (exists) continue;
        meetings.push({ id: newId(), courseId, kind: "class", weekday, start: hhmm(ev.start.date), end: hhmm(ev.end.date), location: ev.location ?? "" });
        res.addedMeetings++;
      }
      if (courseId) touched.add(`${courseId}:meetings`);
      continue;
    }
    if (rule) {
      res.skipped++;
      continue;
    }
    if (!ev.start.allDay && ev.end && ev.end.date > ev.start.date) {
      const isExam = /\b(prelim|exam|midterm|final|quiz)\b/i.test(ev.summary);
      const existing = ev.uid ? commitments.findIndex((c) => c.uid === ev.uid) : -1;
      const fields = { title: ev.summary, start: ev.start.date.toISOString(), end: ev.end.date.toISOString(), courseId, kind: isExam ? ("exam" as const) : ("fixed" as const) };
      if (existing >= 0) commitments[existing] = { ...commitments[existing], ...fields };
      else {
        commitments.push({ id: newId(), source: "ics", uid: ev.uid, ...fields });
        res.addedCommitments++;
      }
      continue;
    }
    const existing = ev.uid ? tasks.findIndex((t) => t.uid === ev.uid) : -1;
    const fields = { title: ev.summary, due: ev.start.date.toISOString(), allDay: ev.start.allDay, courseId };
    if (existing >= 0) {
      tasks[existing] = { ...tasks[existing], ...fields };
      res.updatedTasks++;
    } else {
      tasks.push(newTask({ ...fields, kind: guessKind(ev.summary), source: "ics", uid: ev.uid, evidence: [`Calendar: “${ev.summary.slice(0, 160)}”`] }));
      res.addedTasks++;
    }
    if (courseId) touched.add(`${courseId}:dueDates`);
  }
  // A calendar file covers due dates and/or meetings for the courses it touched.
  const withCoverage = courses.map((c) => ({
    ...c,
    coverage: {
      ...c.coverage,
      dueDates: c.coverage.dueDates || touched.has(`${c.id}:dueDates`),
      meetings: c.coverage.meetings || touched.has(`${c.id}:meetings`),
    },
  }));
  return { data: { ...data, courses: withCoverage, meetings, tasks, commitments }, ...res };
}
