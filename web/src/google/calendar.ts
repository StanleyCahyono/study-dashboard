// Reads Google Calendar into the planner.
//
// * First sync: all events from 7 days ago to 120 days ahead (recurring events
//   expanded into single occurrences). Later syncs: only what changed, using
//   Google's sync token. If Google says the token expired (HTTP 410), it falls
//   back to a full sync for that calendar.
// * The checkpoint (sync token) is saved only after every page was applied, so
//   an interrupted sync simply repeats; items are matched by a stable id, so
//   repeating creates no duplicates.
// * Each calendar has a role chosen by the owner:
//     classes   → class meetings (blocks study time, course linked from title)
//     fixed     → fixed events (blocks study time)
//     busy      → blocks study time, title hidden ("Busy")
//     deadlines → events become tasks (e.g. a subscribed Canvas calendar)
//     ignore    → not used
// * Cancelled events and (by default) invitations you declined are removed.
//   All-day events and events marked "free" don't block time.

import { findOrCreateCourse, guessKind } from "../ics";
import { addLog, newId, newTask, type Commitment, type Data, type GAccount, type GCal, type Task } from "../store";
import { GoogleError, type Http } from "./http";

export const CAL = "https://www.googleapis.com/calendar/v3";
const PAST_DAYS = 7;
const FUTURE_DAYS = 120;

type EventDate = { date?: string; dateTime?: string; timeZone?: string };
export type GEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  htmlLink?: string;
  start?: EventDate;
  end?: EventDate;
  transparency?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  updated?: string;
  etag?: string;
  extendedProperties?: { private?: Record<string, string> };
};
type EventsPage = { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };

export async function listCalendars(http: Http): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const out: { id: string; summary: string; primary: boolean }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await http.get<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[]; nextPageToken?: string }>(`${CAL}/users/me/calendarList`, { pageToken, maxResults: 250 });
    for (const c of page.items ?? []) out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary) });
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export const eventUid = (acc: GAccount, cal: GCal, eventId: string) => `g:${acc.id}:${cal.id}:${eventId}`;
export const calPrefix = (acc: GAccount, cal: GCal) => `g:${acc.id}:${cal.id}:`;

function toDate(d: EventDate | undefined): { at: Date; allDay: boolean } | null {
  if (!d) return null;
  if (d.dateTime) return { at: new Date(d.dateTime), allDay: false };
  if (d.date) {
    const [y, m, day] = d.date.split("-").map(Number);
    return { at: new Date(y, m - 1, day, 23, 59), allDay: true };
  }
  return null;
}

export type Mapped =
  | { kind: "remove"; uid: string }
  | { kind: "commitment"; uid: string; title: string; start: string; end: string; courseText: string; role: GCal["role"]; link?: string; isExam: boolean }
  | { kind: "task"; uid: string; title: string; due: string; allDay: boolean; link?: string };

export function mapEvent(acc: GAccount, cal: GCal, ev: GEvent, includeDeclined: boolean): Mapped {
  const uid = eventUid(acc, cal, ev.id);
  if (ev.status === "cancelled" || cal.role === "ignore") return { kind: "remove", uid };
  const me = ev.attendees?.find((a) => a.self);
  if (me?.responseStatus === "declined" && !includeDeclined) return { kind: "remove", uid };
  const start = toDate(ev.start);
  const end = toDate(ev.end);
  if (!start) return { kind: "remove", uid };
  const title = (ev.summary ?? "").trim() || "(no title)";
  if (cal.role === "deadlines") return { kind: "task", uid, title, due: start.at.toISOString(), allDay: start.allDay, link: ev.htmlLink };
  if (start.allDay || !end || ev.transparency === "transparent") return { kind: "remove", uid };
  return {
    kind: "commitment",
    uid,
    title: cal.role === "busy" ? "Busy" : title,
    start: start.at.toISOString(),
    end: end.at.toISOString(),
    courseText: cal.role === "busy" ? "" : `${title} ${ev.location ?? ""}`,
    role: cal.role,
    link: cal.role === "busy" ? undefined : ev.htmlLink,
    isExam: /\b(prelim|exam|midterm|final|quiz)\b/i.test(title),
  };
}

export type CalendarSync = { mapped: Mapped[]; nextSyncToken: string | null; full: boolean };

/** Fetches every page; returns nothing to save until all pages succeeded. */
export async function fetchCalendarChanges(http: Http, acc: GAccount, cal: GCal, now: Date, includeDeclined: boolean): Promise<CalendarSync> {
  const run = async (syncToken: string | null): Promise<CalendarSync> => {
    const mapped: Mapped[] = [];
    let pageToken: string | undefined;
    let next: string | null = null;
    do {
      const params: Record<string, string | number | boolean | undefined> = { singleEvents: true, maxResults: 250, pageToken };
      if (syncToken) params.syncToken = syncToken;
      else {
        params.timeMin = new Date(now.getTime() - PAST_DAYS * 86400_000).toISOString();
        params.timeMax = new Date(now.getTime() + FUTURE_DAYS * 86400_000).toISOString();
      }
      const page = await http.get<EventsPage>(`${CAL}/calendars/${encodeURIComponent(cal.id)}/events`, params);
      for (const ev of page.items ?? []) mapped.push(mapEvent(acc, cal, ev, includeDeclined));
      pageToken = page.nextPageToken;
      next = page.nextSyncToken ?? next;
    } while (pageToken);
    return { mapped, nextSyncToken: next, full: !syncToken };
  };
  try {
    return await run(cal.syncToken);
  } catch (e) {
    if (e instanceof GoogleError && e.status === 410 && cal.syncToken) return run(null); // checkpoint expired: start over
    throw e;
  }
}

/** Applies a calendar's changes to the data. A full sync also removes items that are gone. */
export function applyCalendarChanges(d: Data, acc: GAccount, cal: GCal, sync: CalendarSync, now: Date): Data {
  const prefix = calPrefix(acc, cal);
  const courses = [...d.courses];
  let commitments = [...d.commitments];
  let tasks = [...d.tasks];
  const seen = new Set<string>();
  let added = 0;
  let changed = 0;
  let removed = 0;
  const notes: string[] = [];

  for (const m of sync.mapped) {
    seen.add(m.uid);
    if (m.kind === "remove") {
      const before = commitments.length;
      commitments = commitments.filter((c) => c.uid !== m.uid);
      // Remove a task only if no work was logged on it; otherwise keep it and say so.
      const t = tasks.find((x) => x.uid === m.uid);
      if (t && !t.done && t.spentMinutes === 0) tasks = tasks.filter((x) => x.uid !== m.uid);
      else if (t && !t.evidence.some((e) => e.startsWith("Removed from Google Calendar"))) {
        tasks = tasks.map((x) => (x.uid === m.uid ? { ...x, evidence: [...x.evidence, `Removed from Google Calendar (${now.toLocaleDateString()}); kept because you logged work on it.`] } : x));
      }
      if (commitments.length !== before || t) removed++;
      continue;
    }
    if (m.kind === "commitment") {
      const courseId = m.role === "classes" || m.isExam ? findOrCreateCourse(courses, m.courseText) : null;
      const c: Commitment = {
        id: commitments.find((x) => x.uid === m.uid)?.id ?? newId(),
        title: m.title,
        start: m.start,
        end: m.end,
        courseId,
        kind: m.role === "classes" ? "class" : m.isExam ? "exam" : "fixed",
        source: "google",
        uid: m.uid,
        accountId: acc.id,
        link: m.link,
      };
      const i = commitments.findIndex((x) => x.uid === m.uid);
      if (i >= 0) {
        if (commitments[i].start !== c.start || commitments[i].end !== c.end) changed++;
        commitments[i] = c;
      } else {
        commitments.push(c);
        added++;
      }
      continue;
    }
    const i = tasks.findIndex((x) => x.uid === m.uid);
    if (i >= 0) {
      const t = tasks[i];
      if (t.due !== m.due) {
        changed++;
        notes.push(`Due date changed for “${m.title}”`);
      }
      // Keep everything the owner set; update only what Google owns.
      tasks[i] = { ...t, title: m.title, due: m.due, allDay: m.allDay, evidence: t.due !== m.due ? [...t.evidence, `Google Calendar moved the due date to ${new Date(m.due).toLocaleString()} (${now.toLocaleDateString()}).`] : t.evidence };
    } else {
      const courseId = findOrCreateCourse(courses, m.title);
      const t: Task = newTask({ title: m.title, due: m.due, allDay: m.allDay, courseId, kind: guessKind(m.title), source: "google", uid: m.uid, accountId: acc.id, evidence: [`Google Calendar${m.link ? `: ${m.link}` : ""}`] });
      tasks.push(t);
      added++;
    }
  }

  if (sync.full) {
    // Anything from this calendar that Google no longer lists is gone.
    const goneC = commitments.filter((c) => c.uid?.startsWith(prefix) && !seen.has(c.uid));
    const goneT = tasks.filter((t) => t.uid?.startsWith(prefix) && !seen.has(t.uid!) && !t.done && t.spentMinutes === 0 && t.due && Date.parse(t.due) > now.getTime() - 7 * 86400_000);
    commitments = commitments.filter((c) => !goneC.includes(c));
    tasks = tasks.filter((t) => !goneT.includes(t));
    removed += goneC.length + goneT.length;
  }

  const accounts = d.accounts.map((a) =>
    a.id !== acc.id ? a : { ...a, calendars: a.calendars.map((c) => (c.id === cal.id ? { ...c, syncToken: sync.nextSyncToken ?? c.syncToken, lastSync: now.toISOString(), error: null } : c)) },
  );
  let out: Data = { ...d, courses, commitments, tasks, accounts };
  if (added || changed || removed || notes.length) {
    out = addLog(out, `${acc.email} · ${cal.summary}`, `${sync.full ? "Full sync" : "Changes"}: ${added} added, ${changed} changed, ${removed} removed.${notes.length ? ` ${notes.join("; ")}.` : ""}`);
  }
  return out;
}
