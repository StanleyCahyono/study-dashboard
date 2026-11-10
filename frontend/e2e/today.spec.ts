import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

const PASSPHRASE = "demo passphrase for e2e";

function issueCode(): string {
  const out = execFileSync("uv", ["run", "studyctl", "enroll", "--demo"], {
    cwd: "..",
    env: { ...process.env, STUDYDASH_DATA_ROOT: process.env.STUDYDASH_E2E_ROOT! },
    encoding: "utf8",
  });
  const match = out.match(/^\s{4}(\S+)\s*$/m);
  if (!match) throw new Error("no code in output");
  return match[1];
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe.configure({ mode: "serial" });

test("private API refuses anonymous requests", async ({ request }) => {
  const r = await request.get("/api/today");
  expect(r.status()).toBe(401);
  expect(r.headers()["cache-control"]).toBe("no-store");
});

test("enroll on a 390px phone and see Today", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enroll this app" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("DEMO");
  await page.getByLabel("One-time code").fill(issueCode());
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await page.getByLabel("Repeat passphrase").fill(PASSPHRASE);
  await page.getByLabel(/Device name/).fill("Test phone");
  await page.getByRole("button", { name: "Enroll" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next class" })).toBeVisible();
  await expect(page.getByText(/AEM 1101|AEM 2200|ECON 1120/).first()).toBeVisible();
  await expect(page.getByText("[Demo]", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Synthetic demo data")).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: "test-results/today-390.png", fullPage: true });
  await ctx.close();
});

test("desktop layout and sign-in with passphrase", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  const cards = page.locator(".grid > .card");
  await expect(cards).toHaveCount(3);
  const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(boxes.map(Math.round)).size).toBe(1); // three columns side by side
  await noHorizontalScroll(page);
  await page.screenshot({ path: "test-results/today-1280.png", fullPage: true });

  await page.getByRole("button", { name: "Devices" }).click();
  await expect(page.getByText("Test phone")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const r = await page.request.get("/api/today");
  expect(r.status()).toBe(401);
  await ctx.close();
});
