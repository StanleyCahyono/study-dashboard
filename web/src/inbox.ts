// Turns email candidates into review-inbox items. Shared by pasted emails and
// Gmail sync. A candidate that matches an existing task or inbox item (same
// course, due within 36 h, overlapping words) is attached as extra evidence
// instead of creating a duplicate.

import type { Candidate } from "./email";
import { looksLikeSame } from "./email";
import { findOrCreateCourse } from "./ics";
import { newId, type Data, type InboxItem } from "./store";

export function addCandidates(d: Data, cands: Candidate[], meta: { accountId?: string; link?: string } = {}): { data: Data; added: number; merged: number } {
  const courses = [...d.courses];
  let tasks = d.tasks;
  let inbox = [...d.inbox];
  let added = 0;
  let merged = 0;
  for (const c of cands) {
    const courseId = c.courseCode ? findOrCreateCourse(courses, c.courseCode) : null;
    const due = c.due?.toISOString() ?? null;
    const probe = { title: c.title, due, courseId };
    const quote = `Email${c.sender ? ` from ${c.sender}` : ""}: “${c.quote.slice(0, 200)}”${meta.link ? ` ${meta.link}` : ""}`;
    const task = tasks.find((t) => !t.done && looksLikeSame(probe, t));
    const pending = inbox.find((i) => (i.status === "pending" || i.status === "accepted") && looksLikeSame(probe, i));
    const item: InboxItem = {
      id: newId(),
      createdAt: new Date().toISOString(),
      title: c.title,
      due,
      allDay: c.allDay,
      courseId,
      quote: c.quote.slice(0, 240),
      sender: c.sender,
      status: task || pending ? "duplicate" : "pending",
      taskId: task?.id ?? pending?.taskId ?? null,
      accountId: meta.accountId,
      link: meta.link,
    };
    if (task) tasks = tasks.map((t) => (t.id === task.id && !t.evidence.includes(quote) ? { ...t, evidence: [...t.evidence, quote] } : t));
    if (task || pending) merged++;
    else added++;
    inbox = [...inbox, item];
  }
  return { data: { ...d, courses, tasks, inbox }, added, merged };
}
