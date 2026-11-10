// Reads a pasted email (or a saved .eml file) and suggests deadlines for review.
// Nothing here ever acts on instructions in the email: it only extracts a
// title, a date and a short quote, which the owner accepts or dismisses.

import { COURSE_CODE } from "./ics";

export type Candidate = { title: string; due: Date | null; allDay: boolean; courseCode: string | null; quote: string; sender: string; subject: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ACTION = /\b(due|deadline|submit|submission|turn in|hand in|upload|complete|finish|bring|prepare|read|quiz|prelim|exam|midterm|presentation|project|assignment|problem set|homework|essay|paper|lab report)\b/i;

/** Minimal .eml handling: headers, quoted-printable, plain-text part; drops quoted replies. */
export function parseEml(raw: string): { subject: string; from: string; body: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const split = text.indexOf("\n\n");
  const headerText = split >= 0 ? text.slice(0, split) : "";
  let body = split >= 0 ? text.slice(split + 2) : text;
  const headers = headerText.replace(/\n[ \t]+/g, " ");
  const h = (name: string) => headers.match(new RegExp(`^${name}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
  const boundary = headers.match(/boundary="?([^";\n]+)"?/i)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`);
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*text\/html/i.test(p)) ?? "";
    const i = plain.indexOf("\n\n");
    const partHeaders = plain.slice(0, i);
    body = plain.slice(i + 2);
    if (/quoted-printable/i.test(partHeaders)) body = decodeQP(body);
    if (/text\/html/i.test(partHeaders)) body = stripHtml(body);
  } else if (/quoted-printable/i.test(headerText)) body = decodeQP(body);
  if (/content-type:\s*text\/html/i.test(headerText) && !boundary) body = stripHtml(body);
  return { subject: h("Subject"), from: h("From"), body: stripQuoted(body) };
}

function decodeQP(s: string): string {
  return s.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));
}

function stripHtml(s: string): string {
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripQuoted(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From:\s/.test(l.trim())) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n");
}

function parseTime(s: string): [number, number] | null {
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i) ?? s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!m) {
    if (/\bnoon\b/i.test(s)) return [12, 0];
    if (/\bmidnight\b/i.test(s)) return [23, 59];
    return null;
  }
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h <= 23 && min <= 59 ? [h, min] : null;
}

/** Finds the first date in a sentence, relative to `now`. */
export function findDate(sentence: string, now: Date): { date: Date; allDay: boolean } | null {
  const s = sentence.toLowerCase();
  let y: number | null = null;
  let mo: number | null = null;
  let d: number | null = null;
  const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  const dayFirst = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/);
  const numeric = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (named) {
    mo = MONTHS.indexOf(named[1].slice(0, 3));
    d = Number(named[2]);
    y = named[3] ? Number(named[3]) : null;
  } else if (dayFirst) {
    mo = MONTHS.indexOf(dayFirst[2].slice(0, 3));
    d = Number(dayFirst[1]);
    y = dayFirst[3] ? Number(dayFirst[3]) : null;
  } else if (numeric) {
    mo = Number(numeric[1]) - 1; // US month/day
    d = Number(numeric[2]);
    y = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
  }
  let date: Date | null = null;
  if (mo != null && d != null && mo >= 0 && mo < 12 && d >= 1 && d <= 31) {
    date = new Date(y ?? now.getFullYear(), mo, d);
    if (y == null && date.getTime() < now.getTime() - 60 * 24 * 3600 * 1000) date = new Date(now.getFullYear() + 1, mo, d);
  } else if (/\btomorrow\b/.test(s)) {
    date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (/\btoday\b|\btonight\b/.test(s)) {
    date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else {
    const wd = s.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (wd) {
      const target = WEEKDAYS.indexOf(wd[2]);
      let add = (target - now.getDay() + 7) % 7;
      if (add === 0) add = 7;
      if (wd[1]) add += add < 7 ? 7 : 0;
      date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
    }
  }
  if (!date) return null;
  const t = parseTime(s);
  if (t) return { date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), t[0], t[1]), allDay: false };
  return { date: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59), allDay: true };
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Suggests deadlines from an email. Returns at most 5 candidates for review. */
export function extractCandidates(input: { subject?: string; from?: string; body: string }, now = new Date()): Candidate[] {
  const subject = (input.subject ?? "").trim();
  const sender = (input.from ?? "").trim();
  const code = (subject.match(COURSE_CODE) ?? input.body.match(COURSE_CODE))?.slice(1, 3).join(" ") ?? null;
  const out: Candidate[] = [];
  for (const s of sentences(input.body)) {
    if (!ACTION.test(s)) continue;
    const when = findDate(s, now);
    if (!when) continue;
    const what = s
      .replace(/\b(please|reminder|note that|just a reminder that)\b[:,]?\s*/gi, "")
      .replace(/\s*(is|are)?\s*(due|by)\b.*$/i, "")
      .trim();
    const title = (what.length >= 4 && what.length <= 90 ? what : subject || s.slice(0, 80)).replace(/[.:,;]$/, "");
    out.push({ title, due: when.date, allDay: when.allDay, courseCode: code, quote: s.slice(0, 240), sender, subject });
    if (out.length >= 5) break;
  }
  if (!out.length && subject && ACTION.test(subject)) {
    const when = findDate(subject, now);
    out.push({ title: subject.slice(0, 90), due: when?.date ?? null, allDay: when?.allDay ?? false, courseCode: code, quote: subject, sender, subject });
  }
  return out;
}

/** Same course, due within 36 hours and overlapping words → probably the same deadline. */
export function looksLikeSame(a: { title: string; due: string | null; courseId: string | null }, b: { title: string; due: string | null; courseId: string | null }): boolean {
  if (a.courseId && b.courseId && a.courseId !== b.courseId) return false;
  if (a.due && b.due && Math.abs(Date.parse(a.due) - Date.parse(b.due)) > 36 * 3600 * 1000) return false;
  const words = (t: string) => new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !["the", "and", "for", "due", "your"].includes(w)));
  const wa = words(a.title);
  const wb = words(b.title);
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common >= Math.min(2, Math.min(wa.size, wb.size));
}
