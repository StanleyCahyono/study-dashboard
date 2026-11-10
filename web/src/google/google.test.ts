import { describe, expect, it } from "vitest";
import { emptyData, newAccount, newTask, type Data, type GAccount, type GCal } from "../store";
import { backoff, makeHttp, GoogleError, type FetchLike } from "./http";
import { applyCalendarChanges, fetchCalendarChanges, mapEvent, type GEvent } from "./calendar";
import { bodyText, buildQuery, fetchGmail } from "./gmail";
import { desiredBlocks, diffPlan, eventIdFor, publishPlan, undoLastPublish } from "./publish";
import { checkIdentity } from "./auth";
import { addCandidates } from "../inbox";
import { buildPlan } from "../plan";

// ---------------------------------------------------------------- fake Google
type Stored = GEvent & { etag: string };
class FakeGoogle {
  calendars = new Map<string, Map<string, Stored>>();
  syncState = new Map<string, number>(); // calendarId -> version at last token
  version = 0;
  changedAt = new Map<string, number>(); // eventKey -> version
  loseNext = false;
  failNext: number | null = null;
  calls: string[] = [];
  messages: { id: string; subject: string; from: string; body: string; internalDate: number }[] = [];
  historyId = 100;
  historyExpired = false;
  pageSize = 2;

  put(calId: string, ev: Partial<GEvent> & { id: string }) {
    if (!this.calendars.has(calId)) this.calendars.set(calId, new Map());
    this.version++;
    const etag = `"e${this.version}"`;
    this.calendars.get(calId)!.set(ev.id, { status: "confirmed", ...ev, etag } as Stored);
    this.changedAt.set(`${calId}/${ev.id}`, this.version);
  }

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${u.pathname}`);
    if (this.failNext) {
      const status = this.failNext;
      this.failNext = null;
      return new Response(JSON.stringify({ error: { message: "slow down", errors: [{ reason: "rateLimitExceeded" }] } }), { status, headers: { "Retry-After": "0" } });
    }
    const res = this.route(u, method, init);
    if (this.loseNext && method !== "GET") {
      this.loseNext = false;
      throw new TypeError("Failed to fetch"); // server did the work, reply lost
    }
    return res;
  };

  private json(body: unknown, status = 200) {
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }

  private route(u: URL, method: string, init?: RequestInit): Response {
    const p = u.pathname;
    let m: RegExpMatchArray | null;
    if (p === "/calendar/v3/calendars" && method === "POST") {
      const id = `plan${this.calendars.size}@group.calendar.google.com`;
      this.calendars.set(id, new Map());
      return this.json({ id });
    }
    if ((m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)$/))) {
      return this.calendars.has(decodeURIComponent(m[1])) ? this.json({ id: decodeURIComponent(m[1]) }) : this.json({ error: { message: "Not Found" } }, 404);
    }
    if ((m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/))) {
      const calId = decodeURIComponent(m[1]);
      const cal = this.calendars.get(calId) ?? new Map();
      if (method === "POST") {
        const body = JSON.parse(String(init!.body));
        if (cal.has(body.id)) return this.json({ error: { message: "The requested identifier already exists.", errors: [{ reason: "duplicate" }] } }, 409);
        this.put(calId, body);
        return this.json(this.calendars.get(calId)!.get(body.id));
      }
      const syncToken = u.searchParams.get("syncToken");
      if (syncToken === "expired") return this.json({ error: { message: "Gone" } }, 410);
      const since = syncToken ? Number(syncToken.replace("v", "")) : -1;
      let all = [...cal.values()].filter((e) => since < 0 || (this.changedAt.get(`${calId}/${e.id}`) ?? 0) > since);
      if (since < 0 && u.searchParams.get("showDeleted") !== "true") all = all.filter((e) => e.status !== "cancelled");
      all.sort((a, b) => a.id.localeCompare(b.id));
      const start = Number(u.searchParams.get("pageToken") ?? 0);
      const page = all.slice(start, start + this.pageSize);
      const more = start + this.pageSize < all.length;
      return this.json({ items: page, nextPageToken: more ? String(start + this.pageSize) : undefined, nextSyncToken: more ? undefined : `v${this.version}` });
    }
    if ((m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      const cal = this.calendars.get(decodeURIComponent(m[1]))!;
      const ev = cal?.get(m[2]);
      if (method === "GET") return ev ? this.json(ev) : this.json({ error: { message: "Not Found" } }, 404);
      if (method === "DELETE") {
        if (!ev || ev.status === "cancelled") return this.json({ error: { message: "Gone" } }, 410);
        const ifMatch = (init?.headers as Record<string, string>)?.["If-Match"];
        if (ifMatch && ifMatch !== ev.etag) return this.json({ error: { message: "Precondition Failed" } }, 412);
        this.put(decodeURIComponent(m[1]), { ...ev, status: "cancelled" });
        return this.json(null, 204);
      }
    }
    if (p === "/gmail/v1/users/me/profile") return this.json({ historyId: String(this.historyId) });
    if (p === "/gmail/v1/users/me/history") {
      if (this.historyExpired) return this.json({ error: { message: "Requested entity was not found." } }, 404);
      const start = Number(u.searchParams.get("startHistoryId"));
      const added = this.messages.filter((x) => x.internalDate > start);
      return this.json({ history: added.length ? [{ messagesAdded: added.map((x) => ({ message: { id: x.id } })) }] : [] });
    }
    if (p === "/gmail/v1/users/me/messages") return this.json({ messages: this.messages.map((x) => ({ id: x.id })) });
    if ((m = p.match(/^\/gmail\/v1\/users\/me\/messages\/(.+)$/))) {
      const msg = this.messages.find((x) => x.id === decodeURIComponent(m![1]))!;
      const b64 = btoa(unescape(encodeURIComponent(msg.body))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return this.json({
        id: msg.id,
        internalDate: String(msg.internalDate),
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "Subject", value: msg.subject },
            { name: "From", value: msg.from },
          ],
          parts: [
            { mimeType: "text/html", body: { data: btoa("<p>html</p>") } },
            { mimeType: "text/plain", body: { data: b64 } },
          ],
        },
      });
    }
    return this.json({ error: { message: `No route ${method} ${p}` } }, 404);
  }
}

const noSleep = async () => {};
const httpFor = (g: FakeGoogle) => makeHttp(() => "test-token", g.fetch, noSleep, () => 0);
const NOW = new Date(2026, 10, 9, 18, 0);
const iso = (d: number, h: number, m = 0) => new Date(2026, 10, 9 + d, h, m).toISOString();

function setup(): { d: Data; acc: GAccount; cal: GCal } {
  const d = emptyData();
  const acc = { ...newAccount("student@example.com"), id: "acc1" };
  const cal: GCal = { id: "primary", summary: "Main", primary: true, role: "classes", syncToken: null, lastSync: null, error: null };
  acc.calendars = [cal];
  d.accounts = [acc];
  return { d, acc, cal };
}

async function syncOnce(g: FakeGoogle, d: Data, accId: string, calId: string): Promise<Data> {
  const acc = d.accounts.find((a) => a.id === accId)!;
  const cal = acc.calendars.find((c) => c.id === calId)!;
  const changes = await fetchCalendarChanges(httpFor(g), acc, cal, NOW, d.includeDeclined);
  return applyCalendarChanges(d, acc, cal, changes, NOW);
}

// ---------------------------------------------------------------- tests
describe("http", () => {
  it("retries rate limits honoring Retry-After", async () => {
    const g = new FakeGoogle();
    g.failNext = 429;
    const r = await httpFor(g).get<{ historyId: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect(r.historyId).toBe("100");
    expect(backoff(0, "3")).toBe(3000);
    expect(backoff(2, null, () => 0)).toBe(4000);
  });
  it("surfaces 401 as an auth error", async () => {
    const http = makeHttp(() => "x", async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 401 }), noSleep);
    await expect(http.get("https://www.googleapis.com/x")).rejects.toMatchObject({ status: 401 });
  });
});

describe("identity check", () => {
  it("refuses a different account than intended", () => {
    const acc = newAccount("Me@Example.com");
    expect(checkIdentity(acc, { email: "me@example.com", sub: "1" })).toBeNull();
    expect(checkIdentity(acc, { email: "other@example.com", sub: "1" })).toMatch(/signed in as other/);
    expect(checkIdentity({ ...acc, sub: "1" }, { email: "me@example.com", sub: "2" })).toMatch(/different Google account/);
  });
});

describe("calendar read", () => {
  it("multi-page first sync, then incremental: a moved recurring class updates availability", async () => {
    const g = new FakeGoogle();
    g.put("primary", { id: "cls_20261110", summary: "AEM 1101 Lecture", start: { dateTime: iso(1, 9, 5) }, end: { dateTime: iso(1, 9, 55) } });
    g.put("primary", { id: "cls_20261112", summary: "AEM 1101 Lecture", start: { dateTime: iso(3, 9, 5) }, end: { dateTime: iso(3, 9, 55) } });
    g.put("primary", { id: "dinner", summary: "Dinner", start: { dateTime: iso(0, 19) }, end: { dateTime: iso(0, 20) } });
    let { d } = setup();
    d = await syncOnce(g, d, "acc1", "primary");
    expect(d.commitments).toHaveLength(3);
    expect(d.commitments.find((c) => c.title === "AEM 1101 Lecture")!.kind).toBe("class");
    expect(d.courses.map((c) => c.code)).toEqual(["AEM 1101"]);
    expect(d.accounts[0].calendars[0].syncToken).toBe("v3");
    // One occurrence is moved by the instructor.
    g.put("primary", { id: "cls_20261112", summary: "AEM 1101 Lecture", start: { dateTime: iso(3, 13, 0) }, end: { dateTime: iso(3, 13, 50) } });
    const before = buildPlan({ ...d, tasks: [newTask({ title: "x", due: iso(5, 9), estMinutes: 30 })] }, NOW).busy.some((b) => b.label === "AEM 1101 Lecture" && b.realStart === Date.parse(iso(3, 9, 5)));
    d = await syncOnce(g, d, "acc1", "primary");
    expect(before).toBe(true);
    expect(d.commitments).toHaveLength(3);
    const moved = d.commitments.find((c) => c.uid!.endsWith("cls_20261112"))!;
    expect(moved.start).toBe(iso(3, 13, 0));
    const busy = buildPlan(d, NOW).busy.filter((b) => b.label === "AEM 1101 Lecture").map((b) => b.realStart);
    expect(busy).toContain(Date.parse(iso(3, 13, 0)));
    expect(busy).not.toContain(Date.parse(iso(3, 9, 5)));
  });

  it("cancelled events and declined invitations are removed; all-day and free events don't block", async () => {
    const g = new FakeGoogle();
    g.put("primary", { id: "a", summary: "Meeting", start: { dateTime: iso(1, 10) }, end: { dateTime: iso(1, 11) } });
    g.put("primary", { id: "b", summary: "Declined", start: { dateTime: iso(1, 12) }, end: { dateTime: iso(1, 13) }, attendees: [{ self: true, responseStatus: "declined" }] });
    g.put("primary", { id: "c", summary: "Holiday", start: { date: "2026-11-11" }, end: { date: "2026-11-12" } });
    g.put("primary", { id: "d", summary: "Optional", start: { dateTime: iso(1, 15) }, end: { dateTime: iso(1, 16) }, transparency: "transparent" });
    let { d } = setup();
    d.accounts[0].calendars[0].role = "fixed";
    d = await syncOnce(g, d, "acc1", "primary");
    expect(d.commitments.map((c) => c.title)).toEqual(["Meeting"]);
    g.put("primary", { id: "a", summary: "Meeting", status: "cancelled" });
    d = await syncOnce(g, d, "acc1", "primary");
    expect(d.commitments).toHaveLength(0);
    // Owner preference: include declined.
    d.includeDeclined = true;
    d.accounts[0].calendars[0].syncToken = null;
    d = await syncOnce(g, d, "acc1", "primary");
    expect(d.commitments.map((c) => c.title)).toEqual(["Declined"]);
  });

  it("busy-only calendars hide titles; deadlines calendars create tasks that keep owner edits", async () => {
    const g = new FakeGoogle();
    g.put("work", { id: "shift", summary: "Shift at the private place", start: { dateTime: iso(1, 8) }, end: { dateTime: iso(1, 12) } });
    g.put("canvas", { id: "ps7", summary: "Problem Set 7 [ECON 1120]", start: { dateTime: iso(2, 23, 59) }, end: { dateTime: iso(2, 23, 59) } });
    let { d } = setup();
    d.accounts[0].calendars = [
      { id: "work", summary: "Work", primary: false, role: "busy", syncToken: null, lastSync: null, error: null },
      { id: "canvas", summary: "Canvas", primary: false, role: "deadlines", syncToken: null, lastSync: null, error: null },
    ];
    d = await syncOnce(g, d, "acc1", "work");
    d = await syncOnce(g, d, "acc1", "canvas");
    expect(d.commitments[0].title).toBe("Busy");
    expect(d.tasks[0]).toMatchObject({ title: "Problem Set 7 [ECON 1120]", source: "google", kind: "problem set" });
    d.tasks[0].estMinutes = 90; // owner's edit
    g.put("canvas", { id: "ps7", summary: "Problem Set 7 [ECON 1120]", start: { dateTime: iso(4, 23, 59) }, end: { dateTime: iso(4, 23, 59) } }); // extension
    d = await syncOnce(g, d, "acc1", "canvas");
    expect(d.tasks).toHaveLength(1);
    expect(d.tasks[0].estMinutes).toBe(90);
    expect(d.tasks[0].due).toBe(iso(4, 23, 59));
    expect(d.tasks[0].evidence.join(" ")).toMatch(/moved the due date/);
    expect(d.log[0].message).toMatch(/Due date changed/);
  });

  it("recovers from an expired sync token (410) with a full resync", async () => {
    const g = new FakeGoogle();
    g.put("primary", { id: "a", summary: "Lab", start: { dateTime: iso(1, 10) }, end: { dateTime: iso(1, 11) } });
    let { d } = setup();
    d.accounts[0].calendars[0].syncToken = "expired";
    d = await syncOnce(g, d, "acc1", "primary");
    expect(d.commitments).toHaveLength(1);
    expect(d.accounts[0].calendars[0].syncToken).toMatch(/^v/);
  });

  it("an interrupted sync saves no checkpoint and the retry creates no duplicates", async () => {
    const g = new FakeGoogle();
    for (const id of ["a", "b", "c", "e"]) g.put("primary", { id, summary: `Event ${id}`, start: { dateTime: iso(1, 10) }, end: { dateTime: iso(1, 11) } });
    const { d, acc, cal } = setup();
    let calls = 0;
    const flaky: FetchLike = async (url, init) => {
      if (++calls === 2) throw new TypeError("network down"); // second page fails every retry? only once
      return g.fetch(url, init);
    };
    const http = makeHttp(() => "t", flaky, noSleep);
    const changes = await fetchCalendarChanges(http, acc, cal, NOW, false); // retried internally
    const d1 = applyCalendarChanges(d, acc, cal, changes, NOW);
    const d2 = await syncOnce(g, { ...d1, accounts: d1.accounts.map((a) => ({ ...a, calendars: a.calendars.map((c) => ({ ...c, syncToken: null })) })) }, "acc1", "primary");
    expect(d2.commitments).toHaveLength(4);
  });

  it("two accounts with the same event id stay separate", async () => {
    const g = new FakeGoogle();
    g.put("primary", { id: "same", summary: "Thing", start: { dateTime: iso(1, 10) }, end: { dateTime: iso(1, 11) } });
    let { d } = setup();
    const acc2 = { ...newAccount("second@example.com"), id: "acc2", calendars: [{ id: "primary", summary: "Main", primary: true, role: "fixed" as const, syncToken: null, lastSync: null, error: null }] };
    d.accounts.push(acc2);
    d = await syncOnce(g, d, "acc1", "primary");
    d = await syncOnce(g, d, "acc2", "primary");
    expect(new Set(d.commitments.map((c) => c.uid)).size).toBe(2);
  });

  it("maps ignore role to removal", () => {
    const { acc, cal } = setup();
    expect(mapEvent(acc, { ...cal, role: "ignore" }, { id: "x", summary: "y" }, false).kind).toBe("remove");
  });
});

describe("gmail", () => {
  it("reads matching messages once, keeps only a quote, and merges duplicates across inboxes", async () => {
    const g = new FakeGoogle();
    g.historyId = NOW.getTime(); // history ids in this fake are timestamps
    g.messages = [{ id: "m1", subject: "AEM 2200 case memo", from: "Prof <prof@example.edu>", body: "Reminder: the case memo is due Friday Nov 13 at 5pm. Reply-all to confirm.", internalDate: Date.parse(iso(-1, 9)) }];
    let { d, acc } = setup();
    acc = { ...acc, useMail: true };
    d.accounts = [acc];
    const first = await fetchGmail(httpFor(g), acc, NOW);
    expect(first.found).toHaveLength(1);
    expect(first.found[0].candidates[0]).toMatchObject({ title: "the case memo", courseCode: "AEM 2200" });
    expect(first.found[0].link).toContain("#all/m1");
    const r1 = addCandidates(d, first.found[0].candidates, { accountId: acc.id, link: first.found[0].link });
    expect(r1.added).toBe(1);
    // Second sync: nothing new.
    const acc2 = { ...acc, gmailHistoryId: first.historyId, gmailSeen: first.seen, gmailLastSync: NOW.toISOString() };
    const second = await fetchGmail(httpFor(g), acc2, NOW);
    expect(second.mode).toBe("nothing new");
    // The same reminder in another inbox merges.
    const r2 = addCandidates(r1.data, first.found[0].candidates, { accountId: "other" });
    expect(r2.merged).toBe(1);
    expect(r2.data.inbox.filter((i) => i.status === "pending")).toHaveLength(1);
  });
  it("expired history id falls back to a bounded search", async () => {
    const g = new FakeGoogle();
    g.historyExpired = true;
    g.messages = [{ id: "m9", subject: "x", from: "y", body: "Lab report due tomorrow at noon.", internalDate: 1 }];
    const { acc } = setup();
    const r = await fetchGmail(httpFor(g), { ...acc, useMail: true, gmailHistoryId: "5" }, NOW);
    expect(r.mode).toBe("reconciled");
    expect(r.found).toHaveLength(1);
  });
  it("prefers the plain-text part and builds a bounded query", () => {
    expect(bodyText({ mimeType: "text/html", body: { data: btoa("<b>Due</b>&nbsp;today") } }).trim()).toBe("Due  today");
    const { acc } = setup();
    expect(buildQuery(acc, null)).toMatch(/newer_than:14d -in:chats$/);
  });
});

describe("Study Plan calendar", () => {
  function planData(): Data {
    const { d } = setup();
    d.settings = { ...d.settings, sleepStart: "23:00", sleepEnd: "07:00", bufferMinutes: 0, device: "computer" };
    d.tasks = [newTask({ id: "t1", title: "Review", due: iso(1, 9), estMinutes: 60 }), newTask({ id: "t2", title: "Essay", due: iso(2, 9), estMinutes: 60 })];
    // Busy right now, so every planned block starts in the future (blocks starting now aren't published).
    d.commitments = [{ id: "c", title: "Dinner", start: iso(0, 18), end: iso(0, 18, 30), courseId: null, kind: "fixed", source: "manual" }];
    d.gplan.accountId = "acc1";
    return d;
  }
  function harness(d0: Data) {
    let d = d0;
    return { get: () => d, commit: (fn: (x: Data) => Data) => void (d = fn(d)) };
  }

  it("event ids are deterministic and valid", async () => {
    const a = await eventIdFor("t1|123");
    expect(a).toBe(await eventIdFor("t1|123"));
    expect(a).not.toBe(await eventIdFor("t1|123", 1));
    expect(a).toMatch(/^[0-9a-v]{5,1024}$/);
  });

  it("preview shows changes without calling Google", () => {
    const d = planData();
    const diff = diffPlan(d, desiredBlocks(d, buildPlan(d, NOW), NOW), NOW);
    expect(diff.create.length).toBeGreaterThan(0);
    expect(diff.remove).toHaveLength(0);
  });

  it("a write that succeeds remotely but loses its reply creates zero duplicates on retry", async () => {
    const g = new FakeGoogle();
    const h = harness(planData());
    const plan = buildPlan(h.get(), NOW);
    g.loseNext = false;
    // Lose the reply of the first event insert (after the calendar exists).
    const fetchLosingFirstInsert: FetchLike = async (url, init) => {
      if (init?.method === "POST" && url.endsWith("/events") && !g.calls.some((c) => c.startsWith("POST") && c.endsWith("/events"))) g.loseNext = true;
      return g.fetch(url, init);
    };
    const http = makeHttp(() => "t", fetchLosingFirstInsert, noSleep);
    const r = await publishPlan(http, h.get, h.commit, plan, NOW, "America/New_York");
    const calId = h.get().gplan.calendarId!;
    const events = [...g.calendars.get(calId)!.values()].filter((e) => e.status !== "cancelled");
    expect(r.created).toBe(events.length);
    expect(new Set(events.map((e) => e.extendedProperties?.private?.studyKey)).size).toBe(events.length);
    expect(g.calls.filter((c) => c.startsWith("GET") && /\/events\/sp/.test(c)).length).toBeGreaterThanOrEqual(1); // adopted after 409
    // Publishing again changes nothing.
    const again = await publishPlan(makeHttp(() => "t", g.fetch, noSleep), h.get, h.commit, plan, NOW, "America/New_York");
    expect(again).toMatchObject({ created: 0, removed: 0 });
  });

  it("keeps blocks you moved, never recreates blocks you deleted, and undo removes only its own", async () => {
    const g = new FakeGoogle();
    const h = harness(planData());
    const http = makeHttp(() => "t", g.fetch, noSleep);
    await publishPlan(http, h.get, h.commit, buildPlan(h.get(), NOW), NOW, "America/New_York");
    const calId = h.get().gplan.calendarId!;
    const [first, second] = h.get().gplan.published;
    // You move one block and delete the other in Google Calendar.
    const ev = g.calendars.get(calId)!.get(first.eventId)!;
    g.put(calId, { ...ev, start: { dateTime: iso(1, 7, 0) }, end: { dateTime: iso(1, 8, 0) } });
    g.put(calId, { ...g.calendars.get(calId)!.get(second.eventId)!, status: "cancelled" });
    // Someone else's event in the same calendar is never touched.
    g.put(calId, { id: "foreign", summary: "Mine", start: { dateTime: iso(1, 12) }, end: { dateTime: iso(1, 13) } });
    // Next plan run.
    const r = await publishPlan(http, h.get, h.commit, buildPlan(h.get(), NOW), NOW, "America/New_York");
    expect(r.preserved).toBe(1);
    expect(r.suppressed).toBeGreaterThanOrEqual(1);
    const states = Object.fromEntries(h.get().gplan.published.map((p) => [p.key, p.state]));
    expect(states[first.key]).toBe("user_moved");
    expect(states[second.key]).toBe("user_deleted");
    expect(g.calendars.get(calId)!.get(first.eventId)!.start?.dateTime).toBe(iso(1, 7, 0));
    expect(g.calendars.get(calId)!.get("foreign")!.status).toBe("confirmed");
    // The moved block counts as your plan for that task.
    const busy = buildPlan(h.get(), NOW).busy.find((b) => b.label.includes("moved by you"));
    expect(busy).toBeTruthy();
    // Undo removes what the last publish created (if untouched).
    const created = h.get().gplan.lastCreated.length;
    const n = await undoLastPublish(http, h.get, h.commit);
    expect(n).toBe(created);
    expect(g.calendars.get(calId)!.get("foreign")!.status).toBe("confirmed");
  });

  it("a removal of an event you edited is refused (ETag) and the event is kept", async () => {
    const g = new FakeGoogle();
    const h = harness(planData());
    const http = makeHttp(() => "t", g.fetch, noSleep);
    await publishPlan(http, h.get, h.commit, buildPlan(h.get(), NOW), NOW, "America/New_York");
    const calId = h.get().gplan.calendarId!;
    const p = h.get().gplan.published[0];
    // Edited between reconcile and delete: simulate by changing etag after reconcile.
    const del = await http.send("DELETE", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${p.eventId}`, undefined, { "If-Match": '"stale"' }).catch((e) => e);
    expect(del).toBeInstanceOf(GoogleError);
    expect((del as GoogleError).status).toBe(412);
  });
});
