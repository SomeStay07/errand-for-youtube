import { join } from "node:path";
import { launch, reporter, consent, sleep, openRealPopup, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-health-recover", port: 9397 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("ytd-app", { state: "attached" });
await page.evaluate(() => {
  const a = document.createElement("a");
  a.href = "/shorts/qaLeak12345";
  a.id = "qa-leak";
  a.textContent = "QA leaked Short";
  a.style.cssText = "position:fixed;top:70px;left:10px;z-index:99999;background:#c00;color:#fff;padding:8px";
  document.querySelector("ytd-app").append(a);
});
await sleep(14000);
const state = async () => {
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  const [id, entry] = Object.entries(health).sort((a, b) => b[1].ts - a[1].ts)[0] || [];
  const tabs = await ctx.worker.evaluate(() => chrome.tabs.query({}).then((t) => t.map((x) => x.id)));
  const tab = Number(id ?? tabs[0]);
  const attr = await page.evaluate(() => document.documentElement.getAttribute("data-er-health"));
  return { tab, attr, entry: entry ? { ...entry, age: Date.now() - entry.ts } : null, badge: await ctx.worker.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), tab), title: await ctx.worker.evaluate((i) => chrome.action.getTitle({ tabId: i }), tab) };
};
const leak = await state();
check("leak: visible /shorts/ link → '!' naming shorts", leak.badge === "!" && leak.entry?.missing.includes("shorts"), leak);
check("leak: html[data-er-health] names the same filters as the background", leak.attr === leak.entry?.missing.join(","), leak.attr);
await page.evaluate(() => document.getElementById("qa-leak").remove());
const box = page.locator('[name="search_query"]').first();
await box.fill("rust ownership");
await box.press("Enter");
await page.waitForURL(/rust/, { timeout: 15000 }).catch(() => {});
await sleep(9000);
const after = await state();
let popupText = null;
try {
  const popup = await openRealPopup(ctx, page);
  popupText = await popup.eval(() => ({ cls: document.getElementById("health").className, hidden: document.getElementById("health").hidden, text: document.getElementById("health").textContent }));
  await popup.screenshot(join(OUT, "H-popup-after-recover.png"));
  await popup.close();
} catch (e) {
  popupText = String(e);
}
await ctx.worker.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 60_000 }));
await sleep(1500);
const pausedAttr = await page.evaluate(() => document.documentElement.getAttribute("data-er-health"));
check("pause: html[data-er-health] removed", pausedAttr === null, pausedAttr);
await ctx.worker.evaluate(() => chrome.storage.local.remove("pausedUntil"));
const swErrs = await ctx.worker.evaluate(() => globalThis.__errs || []);
check("leak fixed + SPA navigation to a clean search: badge cleared", after.badge !== "!", after);
check("leak fixed + SPA navigation: html[data-er-health] = ok", after.attr === "ok", after.attr);
const globalTitle = await ctx.worker.evaluate(() => chrome.action.getTitle({}));
check("leak fixed + SPA navigation: tooltip back to the global title", after.title === globalTitle && !/changed something/i.test(after.title), { tab: after.title, global: globalTitle });
check("leak fixed + SPA navigation: stored health entry is fresh (< 6 s) and clean", after.entry && after.entry.age < 6000 && after.entry.missing.length === 0, after.entry);
check("leak fixed + SPA navigation: popup no longer says 'not working'", !(popupText?.cls === "warn" && !popupText.hidden), { popupText, entry: after.entry });
check("leak fixed + SPA navigation: popup says 'All filters are working'", popupText?.text === "All filters are working" && popupText.hidden === false && popupText.cls !== "warn", popupText);
check("no extension errors", [...ctx.errors, ...swErrs].length === 0, [...ctx.errors, ...swErrs]);
save("H-health-recover.json");
await context.close();
