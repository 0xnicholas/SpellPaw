// E2E — the M4 closed loop, end to end (M5 release readiness):
//   sign in → compose a draft → create a tracked short link →
//   click it twice (fresh visitor + cookie return) → graph moves.
// Magic link is extracted from the dev-server log (/tmp/spellpaw-e2e.log).
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const E2E_EMAIL = `e2e-${Date.now()}@spellpaw.test`;
const LOG_FILE = "/tmp/spellpaw-e2e.log";
const TARGET_URL = "https://example.com/e2e-target";

async function readMagicLink(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const log = (await import("node:fs")).readFileSync(LOG_FILE, "utf8");
    const matches = log.match(/http:\/\/localhost:\d+\/api\/auth\/callback\/email\?[^\s]+/g);
    const link = matches?.at(-1);
    if (link) return link;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("magic link never appeared in the dev-server log");
}

async function signIn(page: Page, context: BrowserContext): Promise<string> {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(E2E_EMAIL);
  await page.getByRole("button", { name: /sign-in link|sign in/i }).click();
  await page.goto(await readMagicLink());
  // The callback lands on the sign-in page (its own callbackUrl); the session
  // cookie is set — navigate to / so the landing redirects into the workspace.
  await page.goto("/");
  await expect(page).toHaveURL(/\/cms[a-z0-9]+\/content/);
  return page.url().match(/(\/cms[a-z0-9]+)\//)?.[1] ?? "";
}

test.describe.serial("closed loop", () => {
  test("compose → shorten → clicks → graph", async ({ page, context, request }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const dashUrl = await signIn(page, context);

    // --- Compose a draft ---
    const title = `E2E post ${Date.now()}`;
    await page.getByPlaceholder(/post title/i).fill(title);
    await page.getByPlaceholder(/write your post/i).fill("The graph grows from real clicks.");
    await page.getByRole("button", { name: /save draft/i }).click();
    await expect(page.getByText(/draft saved/i).first()).toBeVisible();

    // --- Create a tracked short link for the active variant ---
    await page.getByTitle(/create a tracked short link/i).first().click();
    await page.getByPlaceholder(/destination url/i).fill(TARGET_URL);
    await page.getByRole("button", { name: /create & copy/i }).click();
    await expect(page.getByText(/✓ copied/i).first()).toBeVisible();
    const shortUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(shortUrl).toMatch(/^http:\/\/localhost:\d+\/s\/[A-Za-z0-9]{6}$/);
    const code = shortUrl.split("/s/")[1]!;

    // --- Click the link: fresh visitor (301 + cookie), then with the cookie ---
    const first = await request.get(`/s/${code}`, { maxRedirects: 0 });
    expect(first.status()).toBe(301);
    expect(first.headers()["location"]).toBe(TARGET_URL);
    const setCookie = first.headers()["set-cookie"] ?? "";
    expect(setCookie).toContain("sp_c=");

    const second = await request.get(`/s/${code}`, {
      headers: { cookie: setCookie.split(";")[0] },
      maxRedirects: 0,
    });
    expect(second.status()).toBe(301);

    // --- The graph moves: analytics reflect both clicks (one unique contact) ---
    await page.waitForTimeout(3000); // click-touch worker drains quickly
    await page.goto(`${dashUrl}/analytics`);
    await expect(page.getByText(/total touches/i).first()).toBeVisible();
    await page.waitForTimeout(1000);
    const dashboard = await page.evaluate(async () => {
      const r = await fetch("/api/analytics/dashboard");
      return (await r.json()) as { totalTouches: number; uniqueContacts: number };
    });
    expect(dashboard.totalTouches).toBeGreaterThanOrEqual(2);
    expect(dashboard.uniqueContacts).toBeGreaterThanOrEqual(1);
  });
});
