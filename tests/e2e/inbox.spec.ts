// E2E — M6 Inbox closed loop (ADR-0013 mock-first inbound):
//   sign in → connect a mock channel → publish → the simulated comment
//   arrives 30–90s later → reply from the Inbox → the lifecycle moves
//   (AUDIENCE/AWARE → CORRESPONDENT/ENGAGED in the sidebar).
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const E2E_EMAIL = `inbox-${Date.now()}@spellpaw.test`;
const LOG_FILE = "/tmp/spellpaw-e2e.log";
const COMMENTERS =
  /alice chen|bob martinez|carol wang|dave kim|eve novak/i;
const COMMENT_TEXT =
  /exactly what i was looking for|great take|how does this work|solid write-up|bookmarking this/i;

async function readMagicLink(): Promise<string> {
  const email = encodeURIComponent(E2E_EMAIL);
  for (let i = 0; i < 50; i++) {
    const log = (await import("node:fs")).readFileSync(LOG_FILE, "utf8");
    const matches = log.match(/http:\/\/localhost:\d+\/api\/auth\/callback\/email\?[^\s]+/g);
    // Earlier specs in the same server session leave their own links in the
    // log — only consume the one minted for THIS account.
    const link = matches?.filter((l) => l.includes(`email=${email}`)).at(-1);
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
  await page.goto("/");
  await expect(page).toHaveURL(/\/cms[a-z0-9]+\/content/);
  return page.url().match(/(\/cms[a-z0-9]+)\//)?.[1] ?? "";
}

test.describe.serial("inbox closed loop", () => {
  test("publish → simulated comment → reply → lifecycle moves", async ({ page, context }) => {
    test.setTimeout(200_000); // the simulated comment arrives 30–90s after publish
    const dashUrl = await signIn(page, context);

    // --- Connect a mock channel (publishing requires a connection) ---
    await page.goto(`${dashUrl}/channels`);
    const linkedinRow = page.locator("li", { hasText: "LinkedIn" });
    await linkedinRow.getByRole("button", { name: "Connect" }).click();
    // Mock OAuth completes in one hop and bounces back to the channels page —
    // wait for the bounce to fully settle before navigating elsewhere.
    await page.waitForURL(/(\/cms[a-z0-9]+)\/channels/);
    await expect(linkedinRow.getByText("Connected")).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    // --- Compose + publish ---
    await page.goto(`${dashUrl}/content`);
    const title = `Inbox E2E ${Date.now()}`;
    await page.getByPlaceholder(/post title/i).fill(title);
    await page.getByPlaceholder(/write your post/i).fill("The reply pipeline starts here.");
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

    // --- Inbox: wait for the simulated comment to arrive ---
    await page.goto(`${dashUrl}/inbox`);
    const threadRow = page.getByText(COMMENTERS).first();
    await expect(threadRow).toBeVisible({ timeout: 120_000 });
    await threadRow.click();

    // The inbound bubble carries one of the mock comment templates.
    await expect(page.getByText(COMMENT_TEXT).first()).toBeVisible({ timeout: 15_000 });

    // --- Reply → SENT ---
    await page.getByPlaceholder(/write a reply/i).fill("Happy to help — check your inbox!");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Happy to help — check your inbox!")).toBeVisible();

    // --- Sidebar: the lifecycle moved (1 conversation → CORRESPONDENT/ENGAGED) ---
    await expect(page.getByText("CORRESPONDENT").first()).toBeVisible();
    await expect(page.getByText("ENGAGED").first()).toBeVisible();
  });
});
