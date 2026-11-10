import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

function watchOffsite(ctx: BrowserContext): string[] {
  const offsite: string[] = [];
  ctx.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4173/")) offsite.push(r.url());
  });
  return offsite;
}

test("empty app, add a course, class times and a task; data persists", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const offsite = watchOffsite(ctx);
  const page = await ctx.newPage();
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Add classes" }).click();
  await page.getByLabel("Course code").fill("aem 1101");
  await page.getByLabel("Name (optional)").fill("Test course");
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(page.getByText("AEM 1101")).toBeVisible();
  for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) await page.getByLabel(d, { exact: true }).check();
  await page.getByLabel("Starts").fill("23:58");
  await page.getByLabel("Ends").fill("23:59");
  await page.getByRole("button", { name: "Add class time" }).click();
  await expect(page.getByText("Mon 23:58–23:59 · lecture")).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByLabel("What’s due").fill("Problem set 7");
  await page.getByLabel("Course").selectOption({ label: "AEM 1101" });
  await page.getByLabel("Minutes (estimate)").fill("50");
  await page.getByLabel("Due", { exact: true }).fill("2099-01-05T17:00");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Problem set 7")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get started" })).toHaveCount(0);
  await expect(page.locator("#next-class-title + p")).toContainText("AEM 1101");
  await expect(page.getByText("Problem set 7")).toBeVisible();
  await expect(page.getByText("AEM 1101 · about 50 min")).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: "test-results/today-390.png", fullPage: true });

  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByLabel("Mark “Problem set 7” done").click();
  await expect(page.getByText("Open (0)")).toBeVisible();
  expect(offsite).toEqual([]);
  await ctx.close();
});

test("import a calendar file twice without duplicates", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto("./#More");
  const ics = readFileSync("e2e/fixtures/sample.ics");
  await page.getByLabel("Calendar file", { exact: true }).setInputFiles({ name: "sample.ics", mimeType: "text/calendar", buffer: ics });
  await expect(page.getByRole("status")).toContainText("2 new tasks, 0 updated, 2 class times, 2 new courses, 1 skipped");
  await page.getByLabel("Calendar file", { exact: true }).setInputFiles({ name: "sample.ics", mimeType: "text/calendar", buffer: ics });
  await expect(page.getByRole("status")).toContainText("0 new tasks, 2 updated, 0 class times, 0 new courses");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByText("Open (2)")).toBeVisible();
  await expect(page.getByText("Essay 2 draft")).toBeVisible();
  await page.getByRole("button", { name: "Classes", exact: true }).click();
  await expect(page.getByText("ECON 1120")).toBeVisible();
  await expect(page.getByText("Tue 10:10–11:25 · class")).toBeVisible();
  await expect(page.getByText("Thu 10:10–11:25 · class")).toBeVisible();
  await ctx.close();
});

test("backup export and restore; delete all", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("./#More");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByRole("note")).toContainText("DEMO");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup" }).click()]);
  const backup = readFileSync((await download.path())!);
  expect(JSON.parse(backup.toString()).courses).toHaveLength(3);
  await page.getByRole("button", { name: "Delete all data" }).click();
  await expect(page.getByRole("status")).toContainText("deleted");
  await page.getByLabel("Backup file", { exact: true }).setInputFiles({ name: "b.json", mimeType: "application/json", buffer: backup });
  await expect(page.getByRole("status")).toContainText("Backup restored");
  await page.getByLabel("Backup file", { exact: true }).setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole("status")).toContainText("isn’t a Study backup");
  await ctx.close();
});

test("works offline after the first visit", async ({ browser }) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto("./#More");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole("button", { name: "Load demo data" }).click();
  await ctx.setOffline(true);
  await page.goto("./#Today");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Next class" })).toBeVisible();
  await expect(page.getByText(/AEM 1101|AEM 2200|ECON 1120/).first()).toBeVisible();
  await ctx.close();
});

test("desktop layout with demo data", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("./#More");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const tops = await page.locator(".grid > .card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await noHorizontalScroll(page);
  await page.screenshot({ path: "test-results/today-1280.png", fullPage: true });
  await ctx.close();
});
