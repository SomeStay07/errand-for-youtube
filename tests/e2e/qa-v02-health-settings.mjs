import { join } from "node:path";
import { launch, reporter, consent, sleep, searchVideoUrls, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-health-settings", port: 9401 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
const W = () => ctx.worker;
const setSettings = (patch) => W().evaluate((p) => chrome.storage.local.get("settings").then(({ settings }) => {
  const s = globalThis.ErrandLib.mergeSettings(settings);
  return chrome.storage.local.set({ settings: { ...s, ...p, hide: { ...s.hide, ...(p.hide || {}) } } });
}), patch);
const state = async () => {
  const { health = {} } = await W().evaluate(() => chrome.storage.session.get("health"));
  const [id, entry] = Object.entries(health).sort((a, b) => b[1].ts - a[1].ts)[0] || [];
  const tab = Number(id);
  return {
    url: page.url().split("&")[0],
    marker: await page.evaluate(() => window.__qaMarker ?? null),
    attr: await page.evaluate(() => document.documentElement.getAttribute("data-er-health")),
    entry: entry ? { ...entry, age: Date.now() - entry.ts } : null,
    badge: id ? await W().evaluate((i) => chrome.action.getBadgeText({ tabId: i }), tab) : null,
    title: id ? await W().evaluate((i) => chrome.action.getTitle({ tabId: i }), tab) : null,
  };
};
const waitFor = async (pred, ms = 12000) => {
  const t0 = Date.now();
  let s = await state();
  while (!pred(s) && Date.now() - t0 < ms) {
    await sleep(500);
    s = await state();
  }
  return { ...s, after: Date.now() - t0 };
};

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("ytd-app", { state: "attached" });
await page.evaluate(() => {
  window.__qaMarker = 1;
  const a = document.createElement("a");
  a.href = "/shorts/qaLeak12345";
  a.id = "qa-leak";
  a.textContent = "QA leaked Short";
  a.style.cssText = "position:fixed;top:70px;left:10px;z-index:99999;background:#c00;color:#fff;padding:8px";
  document.querySelector("ytd-app").append(a);
});
const sLeak = await waitFor((s) => s.badge === "!", 18000);
check("S1 search: visible Shorts link → '!' and html[data-er-health] = stored missing list", sLeak.badge === "!" && sLeak.entry?.missing.includes("shorts") && sLeak.attr === sLeak.entry.missing.join(","), sLeak);
await page.screenshot({ path: join(OUT, "HS-search-leak.png") });
await setSettings({ shortsMode: "show" });
const sOff = await waitFor((s) => s.badge !== "!" && s.attr === "ok", 12000);
check("S1 untick Shorts (shortsMode=show) while '!' shows → '!' cleared without navigation", sOff.badge !== "!" && sOff.attr === "ok" && sOff.entry?.missing.length === 0 && sOff.marker === 1 && sOff.url === sLeak.url, sOff);
check("S1 tooltip back to normal after the settings change", sOff.title && !/changed something/i.test(sOff.title), sOff.title);
await page.evaluate(() => document.getElementById("qa-leak")?.remove());
await setSettings({ shortsMode: "watch" });
await sleep(1000);

const [video] = await searchVideoUrls(page, QUERY, 4);
await page.goto(video, { waitUntil: "domcontentloaded" });
await page.waitForSelector("ytd-watch-flexy #related", { state: "attached", timeout: 20000 });
await sleep(8000);
const wBase = await state();
check("S2 watch baseline: no '!', html[data-er-health] = ok", wBase.badge !== "!" && wBase.attr === "ok", wBase);
await page.evaluate(() => {
  window.__qaMarker = 1;
  document.querySelector("ytd-watch-flexy #related")?.remove();
});
await setSettings({ endPrompt: false });
const wLeak = await waitFor((s) => s.badge === "!", 18000);
check("S2 watch: #related removed + unrelated settings change → '!' naming related, attr matches", wLeak.badge === "!" && wLeak.entry?.missing.includes("related") && wLeak.attr === wLeak.entry.missing.join(","), wLeak);
await page.screenshot({ path: join(OUT, "HS-watch-related-missing.png") });
await setSettings({ hide: { related: false } });
const wOff = await waitFor((s) => s.badge !== "!", 12000);
check("S2 untick Recommendations while '!' shows → '!' cleared without navigation", wOff.badge !== "!" && wOff.attr === "ok" && wOff.entry?.missing.length === 0 && wOff.marker === 1 && wOff.url === wLeak.url, wOff);
await page.screenshot({ path: join(OUT, "HS-watch-after-untick.png") });

const swErrs = await W().evaluate(() => globalThis.__errs || []);
check("no extension errors", [...ctx.errors, ...swErrs].length === 0, [...ctx.errors, ...swErrs]);
save("HS-health-settings.json");
await context.close();
