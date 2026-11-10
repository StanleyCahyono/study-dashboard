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

async function vaultDump(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        const req = indexedDB.open("studydash-offline", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("vault");
        req.onsuccess = () => {
          const g = req.result.transaction("vault").objectStore("vault").get("current");
          g.onsuccess = () => resolve(g.result ? JSON.stringify(g.result) : null);
          g.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      }),
  );
}

test("phone keeps an encrypted copy that opens offline and is wiped on sign-out", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await expect(page.getByLabel(/Keep a locked copy/)).toBeChecked();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Next class" })).toBeVisible();

  await expect.poll(async () => (await vaultDump(page)) ?? "").toContain("savedAt");
  const stored = (await vaultDump(page))!;
  for (const secret of ["[Demo]", "AEM", "ECON", PASSPHRASE]) expect(stored).not.toContain(secret);

  // Server unreachable: the cached shell opens and offers the saved copy.
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Can’t reach your study server" })).toBeVisible();
  await page.getByLabel("Passphrase").fill("not the passphrase at all");
  await page.getByRole("button", { name: "Open saved copy" }).click();
  await expect(page.getByRole("alert")).toContainText("Incorrect passphrase");
  await page.getByLabel("Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open saved copy" }).click();
  await expect(page.getByRole("note")).toContainText("Saved copy");
  await expect(page.getByText(/AEM 1101|AEM 2200|ECON 1120/).first()).toBeVisible();
  await noHorizontalScroll(page);
  await page.screenshot({ path: "test-results/saved-copy-390.png", fullPage: true });

  // Back online: live again; signing out wipes the copy.
  await ctx.setOffline(false);
  await page.getByRole("button", { name: "Try to reconnect" }).click();
  await expect(page.getByRole("button", { name: "Devices" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await vaultDump(page)).toBeNull();
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.getByText("There’s no saved copy on this device.")).toBeVisible();
  await ctx.close();
});

test("unticking the box keeps nothing on the device", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await page.getByLabel(/Keep a locked copy/).uncheck();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Next class" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(await vaultDump(page)).toBeNull();
  await ctx.close();
});
