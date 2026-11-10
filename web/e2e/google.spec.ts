// Google flow in the browser with Google simulated (no real account is used).
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const SELF = "http://127.0.0.1:4173/";
const ALLOWED = [SELF, "https://accounts.google.com/gsi/", "https://www.googleapis.com/", "https://gmail.googleapis.com/"];
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true }).click();

function at(days: number, h: number, m = 0) {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + days, h, m).toISOString();
}

async function fakeGoogle(ctx: BrowserContext, opts: { email: string }) {
  const state = { inserts: 0, deletes: 0, events: new Map<string, Record<string, unknown>>(), requests: [] as string[] };
  await ctx.route("https://accounts.google.com/gsi/client", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `window.google={accounts:{oauth2:{initTokenClient:function(c){return{requestAccessToken:function(){setTimeout(function(){c.callback({access_token:"fake-token",expires_in:3600,scope:c.scope})},10)}}},revoke:function(t,d){d&&d()}}}};`,
    }),
  );
  await ctx.route(/https:\/\/(www|gmail)\.googleapis\.com\/.*/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    state.requests.push(`${req.method()} ${u.pathname}`);
    expect(req.headers()["authorization"]).toBe("Bearer fake-token");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = u.pathname;
    if (p === "/oauth2/v3/userinfo") return json({ email: opts.email, sub: "sub-123", email_verified: true });
    if (p === "/calendar/v3/users/me/calendarList")
      return json({ items: [{ id: "primary", summary: "Main", primary: true }, { id: "canvas@cal.example", summary: "Canvas" }] });
    if (p === "/calendar/v3/calendars/primary/events")
      return json({ items: [{ id: "lec1", summary: "AEM 1101 Lecture", start: { dateTime: at(1, 10) }, end: { dateTime: at(1, 11) }, htmlLink: "https://calendar.google.com/x" }], nextSyncToken: "s1" });
    if (p === `/calendar/v3/calendars/${encodeURIComponent("canvas@cal.example")}/events`)
      return json({ items: [{ id: "ps9", summary: "Problem Set 9 [ECON 1120]", start: { dateTime: at(3, 23, 59) }, end: { dateTime: at(3, 23, 59) } }], nextSyncToken: "s2" });
    if (p === "/calendar/v3/calendars" && req.method() === "POST") return json({ id: "plan123@cal.example" });
    if (p === "/calendar/v3/calendars/plan123%40cal.example") return json({ id: "plan123@cal.example" });
    if (p === "/calendar/v3/calendars/plan123%40cal.example/events") {
      if (req.method() === "POST") {
        const body = JSON.parse(req.postData()!);
        expect(body.attendees).toBeUndefined();
        state.inserts++;
        const ev = { ...body, etag: `"e${state.inserts}"`, status: "confirmed" };
        state.events.set(body.id, ev);
        return json(ev);
      }
      return json({ items: [...state.events.values()] });
    }
    const del = p.match(/^\/calendar\/v3\/calendars\/plan123%40cal\.example\/events\/(.+)$/);
    if (del && req.method() === "DELETE") {
      state.deletes++;
      state.events.delete(del[1]);
      return route.fulfill({ status: 204 });
    }
    return json({ error: { message: `unhandled ${p}` } }, 404);
  });
  return state;
}

test("connect Google, sync calendars into the plan, publish and undo the Study Plan calendar", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const offsite: string[] = [];
  ctx.on("request", (r) => {
    if (!ALLOWED.some((a) => r.url().startsWith(a))) offsite.push(r.url());
  });
  const g = await fakeGoogle(ctx, { email: "student@example.com" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("./#More");

  await page.getByLabel("Google client ID").fill("1234-abc.apps.googleusercontent.com");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByLabel("Google account email").fill("student@example.com");
  await page.getByRole("button", { name: "Connect with Google" }).click();
  await expect(page.getByText(/Connected student@example.com/)).toBeVisible();

  await page.getByText(/^Calendars \(/).click();
  await page.getByLabel("How to use Main").selectOption("classes");
  await page.getByLabel("How to use Canvas").selectOption("deadlines");
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/Calendar synced/)).toBeVisible();

  await tab(page, "Tasks");
  await expect(page.getByText("Problem Set 9 [ECON 1120]")).toBeVisible();
  await tab(page, "Today");
  await expect(page.getByText(/Google synced/)).toBeVisible();

  await tab(page, "Plan");
  await page.getByLabel("Account").selectOption({ label: "student@example.com" });
  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(page.getByText(/Preview/).first()).toBeVisible();
  const toAdd = Number((await page.locator(".preview-list p").first().innerText()).match(/(\d+) to add/)![1]);
  expect(toAdd).toBeGreaterThan(0);
  expect(g.inserts).toBe(0); // preview didn't touch Google
  await page.getByRole("button", { name: "Publish to Google" }).click();
  await expect(page.getByText(new RegExp(`${toAdd} added`))).toBeVisible();
  expect(g.inserts).toBe(toAdd);
  await page.getByRole("button", { name: "Undo last publish" }).click();
  await expect(page.getByText(new RegExp(`removed ${toAdd} block`))).toBeVisible();
  expect(g.deletes).toBe(toAdd);
  expect(offsite).toEqual([]);
  await ctx.close();
});

test("signing in as a different account than intended is refused", async ({ browser }) => {
  const ctx = await browser.newContext();
  await fakeGoogle(ctx, { email: "someone-else@example.com" });
  const page = await ctx.newPage();
  await page.goto("./#More");
  await page.getByLabel("Google client ID").fill("1234-abc.apps.googleusercontent.com");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByLabel("Google account email").fill("student@example.com");
  await page.getByRole("button", { name: "Connect with Google" }).click();
  await expect(page.getByText(/You signed in as someone-else@example.com/).first()).toBeVisible();
  await ctx.close();
});
