import { join } from "node:path";
import { launch, consent, sleep, until, closeWelcome, searchVideoUrls, OUT } from "./harness.mjs";
const ARM = process.env.ARM || "ext";
const ctx = await launch({ name: `reveal-probe-${ARM}`, extension: ARM === "ext" });
if (ARM === "ext") await closeWelcome(ctx);
const page = ctx.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await ctx.context.newPage());
if (process.env.SCHEME) await page.emulateMedia({ colorScheme: process.env.SCHEME });
const urls = await searchVideoUrls(page, undefined, 3);
const probe = () => page.evaluate(() => {
  const rel = document.querySelector("ytd-watch-flexy #related");
  const items = [...document.querySelectorAll("#related yt-lockup-view-model, #related ytd-compact-video-renderer, ytd-watch-next-secondary-results-renderer yt-lockup-view-model")];
  return { url: location.pathname + location.search.slice(0, 15), relatedAttached: Boolean(rel), relatedDisplay: rel ? getComputedStyle(rel).display : null, relatedH: rel ? Math.round(rel.getBoundingClientRect().height) : null, items: items.length, itemsVisible: items.filter((n) => n.getClientRects().length).length, reveal: Boolean(document.getElementById("er-reveal")), revealedAttr: document.documentElement.hasAttribute("data-er-reveal"), dark: document.documentElement.hasAttribute("dark") };
});
for (const [i, u] of urls.entries()) {
  await page.goto(u, { waitUntil: "domcontentloaded" });
  await sleep(6000);
  const before = await probe();
  let after = null;
  if (before.reveal) {
    await page.locator("#er-reveal").click();
    await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-er-reveal")), Boolean, 15000, 250);
    await sleep(4000);
    after = await probe();
  }
  console.log(JSON.stringify({ i, before, after }));
  await page.screenshot({ path: join(OUT, `reveal-${ARM}-${process.env.SCHEME || "dark"}-${i}.png`) });
}
await ctx.context.close();
