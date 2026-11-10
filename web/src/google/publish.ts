// Publishes planned study blocks to a dedicated private "Study Plan" calendar.
//
// Safety rules:
// * Uses the calendar.app.created permission: it can only touch calendars this
//   app created. It never invites anyone and never edits other calendars.
// * Only future blocks the app created are changed. Blocks you moved in Google
//   Calendar are kept as you left them; blocks you deleted are never recreated.
// * Each block gets a deterministic event id derived from (task, start). If a
//   create succeeds at Google but the reply is lost, the retry gets 409
//   "already exists"; the app then reads the event and adopts it, so retries
//   create zero duplicates.
// * Removals use the event's ETag (If-Match), so an event you edited in the
//   meantime is left alone.
// * "Preview" computes the changes without touching Google.

import { addLog, type Data, type PublishedBlock } from "../store";
import { GoogleError, type Http } from "./http";
import { CAL, type GEvent } from "./calendar";
import type { Plan } from "../plan";

export const PLAN_CALENDAR_NAME = "Study Plan";
const HORIZON_DAYS = 7;
const MIN_LEAD_MS = 5 * 60_000;

export type Desired = { key: string; taskId: string; title: string; start: string; end: string };
export type PlanDiff = { create: Desired[]; remove: PublishedBlock[]; keep: PublishedBlock[]; suppressed: number };

export function blockKey(taskId: string, startMs: number): string {
  return `${taskId}|${startMs}`;
}

/** Base32hex (0-9, a-v) of SHA-256: valid as a Google Calendar event id. */
export async function eventIdFor(key: string, attempt = 0): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}#${attempt}`)));
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes.slice(0, 20)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `sp${out}`;
}

export function desiredBlocks(data: Data, plan: Plan, now: Date): Desired[] {
  const until = now.getTime() + HORIZON_DAYS * 86400_000;
  return plan.blocks
    .filter((b) => b.start >= now.getTime() + MIN_LEAD_MS && b.start < until)
    .map((b) => ({
      key: blockKey(b.taskId, b.start),
      taskId: b.taskId,
      title: `Study: ${data.tasks.find((t) => t.id === b.taskId)?.title ?? "task"}`,
      start: new Date(b.start).toISOString(),
      end: new Date(b.end).toISOString(),
    }));
}

export function diffPlan(data: Data, desired: Desired[], now: Date): PlanDiff {
  const active = data.gplan.published.filter((p) => p.state === "active");
  const want = new Set(desired.map((d) => d.key));
  const have = new Set(data.gplan.published.filter((p) => p.state !== "removed").map((p) => p.key));
  const suppressed = new Set(data.gplan.suppressed);
  return {
    create: desired.filter((d) => !have.has(d.key) && !suppressed.has(d.key)),
    remove: active.filter((p) => !want.has(p.key) && Date.parse(p.start) > now.getTime()),
    keep: active.filter((p) => want.has(p.key)),
    suppressed: desired.filter((d) => suppressed.has(d.key)).length,
  };
}

export async function ensurePlanCalendar(http: Http, data: Data, timeZone: string): Promise<string> {
  if (data.gplan.calendarId) {
    try {
      await http.get(`${CAL}/calendars/${encodeURIComponent(data.gplan.calendarId)}`);
      return data.gplan.calendarId;
    } catch (e) {
      if (!(e instanceof GoogleError && (e.status === 404 || e.status === 410))) throw e;
    }
  }
  const cal = await http.send<{ id: string }>("POST", `${CAL}/calendars`, {
    summary: PLAN_CALENDAR_NAME,
    description: "Study blocks planned by the Study app. Move or delete them freely; the app keeps your changes.",
    timeZone,
  });
  return cal.id;
}

/** Looks at what the owner did in Google since the last publish. */
export async function reconcile(http: Http, calId: string, published: PublishedBlock[], now: Date): Promise<{ published: PublishedBlock[]; newlySuppressed: string[]; moved: number }> {
  const byId = new Map<string, GEvent>();
  let pageToken: string | undefined;
  do {
    const page = await http.get<{ items?: GEvent[]; nextPageToken?: string }>(`${CAL}/calendars/${encodeURIComponent(calId)}/events`, {
      showDeleted: true,
      singleEvents: true,
      timeMin: new Date(now.getTime() - 86400_000).toISOString(),
      maxResults: 250,
      pageToken,
    });
    for (const ev of page.items ?? []) byId.set(ev.id, ev);
    pageToken = page.nextPageToken;
  } while (pageToken);
  const newlySuppressed: string[] = [];
  let moved = 0;
  const out = published.map((p) => {
    if (p.state !== "active" || Date.parse(p.end) < now.getTime() - 86400_000) return p;
    const ev = byId.get(p.eventId);
    if (!ev || ev.status === "cancelled") {
      newlySuppressed.push(p.key);
      return { ...p, state: "user_deleted" as const };
    }
    if (ev.etag && ev.etag !== p.etag) {
      moved++;
      return { ...p, state: "user_moved" as const, start: ev.start?.dateTime ?? p.start, end: ev.end?.dateTime ?? p.end };
    }
    return p;
  });
  return { published: out, newlySuppressed, moved };
}

async function createBlock(http: Http, calId: string, d: Desired, now: Date): Promise<PublishedBlock> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = await eventIdFor(d.key, attempt);
    const body = {
      id,
      summary: d.title,
      description: "Planned by the Study app. Move or delete it freely; the app keeps your changes.",
      start: { dateTime: d.start },
      end: { dateTime: d.end },
      transparency: "opaque",
      extendedProperties: { private: { studyKey: d.key } },
    };
    try {
      const ev = await http.send<GEvent>("POST", `${CAL}/calendars/${encodeURIComponent(calId)}/events`, body);
      return { key: d.key, eventId: id, etag: ev.etag ?? "", start: d.start, end: d.end, taskId: d.taskId, title: d.title, publishedAt: now.toISOString(), state: "active" };
    } catch (e) {
      if (!(e instanceof GoogleError && e.status === 409)) throw e;
      // Already exists: probably our earlier attempt whose reply was lost.
      const ev = await http.get<GEvent>(`${CAL}/calendars/${encodeURIComponent(calId)}/events/${id}`);
      if (ev.status !== "cancelled" && ev.extendedProperties?.private?.studyKey === d.key) {
        return { key: d.key, eventId: id, etag: ev.etag ?? "", start: d.start, end: d.end, taskId: d.taskId, title: d.title, publishedAt: now.toISOString(), state: "active" };
      }
      // A deleted event keeps its id forever: use the next id.
    }
  }
  throw new Error(`Couldn’t create “${d.title}”.`);
}

async function removeBlock(http: Http, calId: string, p: PublishedBlock): Promise<PublishedBlock> {
  try {
    await http.send("DELETE", `${CAL}/calendars/${encodeURIComponent(calId)}/events/${p.eventId}`, undefined, p.etag ? { "If-Match": p.etag } : {});
    return { ...p, state: "removed" };
  } catch (e) {
    if (e instanceof GoogleError && (e.status === 404 || e.status === 410)) return { ...p, state: "removed" };
    if (e instanceof GoogleError && e.status === 412) return { ...p, state: "user_moved" }; // edited by you since: leave it
    throw e;
  }
}

export type PublishResult = { created: number; removed: number; preserved: number; suppressed: number };

/**
 * Publishes the plan. `commit` is called after every change so progress is
 * saved even if the app is closed midway.
 */
export async function publishPlan(http: Http, getData: () => Data, commit: (fn: (d: Data) => Data) => void, plan: Plan, now: Date, timeZone: string): Promise<PublishResult> {
  const calId = await ensurePlanCalendar(http, getData(), timeZone);
  commit((d) => ({ ...d, gplan: { ...d.gplan, calendarId: calId } }));
  const rec = await reconcile(http, calId, getData().gplan.published, now);
  commit((d) => ({ ...d, gplan: { ...d.gplan, published: rec.published, suppressed: [...new Set([...d.gplan.suppressed, ...rec.newlySuppressed])] } }));
  const diff = diffPlan(getData(), desiredBlocks(getData(), plan, now), now);
  const created: string[] = [];
  for (const d of diff.create) {
    const pb = await createBlock(http, calId, d, now);
    created.push(pb.key);
    commit((x) => ({ ...x, gplan: { ...x.gplan, published: [...x.gplan.published.filter((p) => p.key !== pb.key), pb] } }));
  }
  let removed = 0;
  let preserved = rec.moved;
  for (const p of diff.remove) {
    const r = await removeBlock(http, calId, p);
    if (r.state === "removed") removed++;
    else preserved++;
    commit((x) => ({ ...x, gplan: { ...x.gplan, published: x.gplan.published.map((q) => (q.key === p.key ? r : q)) } }));
  }
  commit((x) =>
    addLog(
      { ...x, gplan: { ...x.gplan, lastPublish: now.toISOString(), lastCreated: created } },
      "Study Plan calendar",
      `Published: ${created.length} added, ${removed} removed, ${preserved} kept as you edited them, ${rec.newlySuppressed.length + diff.suppressed} you deleted (not recreated).`,
    ),
  );
  return { created: created.length, removed, preserved, suppressed: rec.newlySuppressed.length + diff.suppressed };
}

/** Undo the last publish: removes the blocks it added, unless you've edited them since. */
export async function undoLastPublish(http: Http, getData: () => Data, commit: (fn: (d: Data) => Data) => void): Promise<number> {
  const d = getData();
  if (!d.gplan.calendarId) return 0;
  let n = 0;
  for (const key of d.gplan.lastCreated) {
    const p = getData().gplan.published.find((x) => x.key === key && x.state === "active");
    if (!p) continue;
    const r = await removeBlock(http, d.gplan.calendarId, p);
    if (r.state === "removed") n++;
    commit((x) => ({ ...x, gplan: { ...x.gplan, published: x.gplan.published.map((q) => (q.key === key ? r : q)) } }));
  }
  commit((x) => addLog({ ...x, gplan: { ...x.gplan, lastCreated: [] } }, "Study Plan calendar", `Undo: removed ${n} block(s) from the last publish.`));
  return n;
}
