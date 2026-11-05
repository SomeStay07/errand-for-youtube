import { join } from "node:path";
import { launch, consent, sleep, until, closeWelcome, QUERY, OUT } from "./harness.mjs";
const ARM = process.env.ARM || "ext";
const ctx = await launch({ name: `reveal-spa-${ARM}`, extension: ARM === "ext" });
if (ARM === "ext") await closeWelcome(ctx);
const page = ctx.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await ctx.context.newPage());
if (process.env.SCHEME) await page.emulateMedia({ colorScheme: process.env.SCHEME });
const probe = () => page.evaluate(() => {
  const rel = document.querySelector("ytd-watch-flexy #related");
  const items = [...document.querySelectorAll("ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-flexy #related ytd-compact-video-renderer")];
  return { url: location.search.slice(0, 15), relatedDisplay: rel ? getComputedStyle(rel).display : null, items: items.length, itemsVisible: items.filter((n) => n.getClientRects().length).length, reveal: Boolean(document.getElementById("er-reveal")), revealedAttr: document.documentElement.hasAttribute("data-er-reveal") };
});
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector('ytd-video-renderer a#thumbnail[href^="/watch"]', { timeout: 20000 });
await sleep(2500);
for (let i = 0; i < 4; i++) {
  await page.locator('ytd-video-renderer a#thumbnail[href^="/watch"]').nth(i).click();
  await page.waitForURL(/watch/, { timeout: 15000 });
  await sleep(5000);
  const before = await probe();
  let after = null;
  if (before.reveal) {
    await page.locator("#er-reveal").click();
    await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-er-reveal")), Boolean, 15000, 250);
    await sleep(5000);
    after = await probe();
  }
  await sleep(ARM === "ext" ? 0 : 0);
  console.log(JSON.stringify({ i, before, after, later: await (async () => { await sleep(8000); return probe(); })() }));
  await page.screenshot({ path: join(OUT, `spa-${ARM}-${i}.png`) });
  await page.goBack();
  await page.waitForURL(/results/, { timeout: 15000 });
  await sleep(2000);
}
await ctx.context.close();
