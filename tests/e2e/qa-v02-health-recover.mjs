import { join } from "node:path";
import { launch, reporter, consent, until, openRealPopup, closeWelcome, healthOf, recheck, injectShortsLeak, trackHealthCycles, healthCycles, finish, messages, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const { msg } = messages();
const ctx = await launch({ name: "qa-health-recover" });
const { context } = ctx;
await closeWelcome(ctx);
const page = context.pages()[0] || (await context.newPage());
await trackHealthCycles(page);
const attr = () => page.evaluate(() => document.documentElement.getAttribute("data-er-health"));
const state = async () => ({ ...(await healthOf(ctx)), attr: await attr() });

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model", { timeout: 20000 });
const { value: clean } = await until(state, (s) => s.entry?.page === "search" && s.entry.missing.length === 0 && s.attr === "ok", 20000, 500);
check("precondition: the load's own check cycle reported clean before the leak appears", clean.entry?.missing.length === 0 && clean.attr === "ok", clean);
await injectShortsLeak(page);
const leakCycle = await recheck(ctx);
const { value: leak, ms: leakMs } = await until(state, (s) => s.badge === "!" && s.entry?.ts > leakCycle, 25000, 500);
check("leak after a clean report: the next settings change reports '!' naming shorts", leak.badge === "!" && leak.entry?.missing.includes("shorts"), { leakMs, ...leak });
check("leak: html[data-er-health] names the same filters as the background", Boolean(leak.entry) && leak.attr === leak.entry.missing.join(","), leak.attr);

await page.evaluate(() => document.getElementById("qa-leak").remove());
const box = page.locator('[name="search_query"]').first();
await box.fill("rust ownership");
const navAt = Date.now();
await box.press("Enter");
await page.waitForURL(/rust/, { timeout: 15000 }).catch(() => {});
const { value: after, ms: healMs } = await until(state, (s) => s.entry?.ts > navAt && s.entry.missing.length === 0 && s.attr === "ok", 25000, 500);
const cycles = await healthCycles(page);
let popupText = null;
try {
  const popup = await openRealPopup(ctx, page);
  popupText = await popup.eval(() => ({ cls: document.getElementById("health").className, hidden: document.getElementById("health").hidden, text: document.getElementById("health").textContent }));
  await popup.screenshot(join(OUT, "H-popup-after-recover.png"));
  await popup.close();
} catch (e) {
  popupText = String(e);
}
check("leak fixed + SPA navigation to a clean search: badge cleared", after.badge !== "!", after);
check("leak fixed + SPA navigation: html[data-er-health] = ok", after.attr === "ok", after.attr);
const globalTitle = await ctx.worker.evaluate(() => chrome.action.getTitle({}));
check("leak fixed + SPA navigation: tooltip back to the global title", after.title === globalTitle && !/changed something/i.test(after.title), { tab: after.title, global: globalTitle });
check("leak fixed + SPA navigation: stored health entry is written after the navigation and clean", after.entry?.ts > navAt && after.entry.missing.length === 0, { healMs, entry: after.entry, cycles });
check("leak fixed + SPA navigation: popup says 'All filters are working'", popupText?.text === msg("healthOk") && popupText.hidden === false && popupText.cls !== "warn", popupText);

await ctx.worker.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 60_000 }));
const { value: pausedAttr } = await until(attr, (a) => a === null, 5000, 100);
check("pause: html[data-er-health] removed", pausedAttr === null, pausedAttr);
await ctx.worker.evaluate(() => chrome.storage.local.remove("pausedUntil"));
await finish(ctx, check);
save("H-health-recover.json");
await context.close();
