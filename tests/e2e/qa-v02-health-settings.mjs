import { join } from "node:path";
import { launch, reporter, consent, until, searchVideoUrls, closeWelcome, healthOf, recheck, settingsApi, injectShortsLeak, finish, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-health-settings" });
const { context } = ctx;
await closeWelcome(ctx);
const page = context.pages()[0] || (await context.newPage());
const { set: setSettings } = settingsApi(ctx);
const state = async () => ({
  ...(await healthOf(ctx)),
  url: page.url().split("&")[0],
  marker: await page.evaluate(() => window.__qaMarker ?? null),
  attr: await page.evaluate(() => document.documentElement.getAttribute("data-er-health")),
});
const waitFor = async (pred, ms) => {
  const { value, ms: after } = await until(state, pred, ms, 500);
  return { ...value, after };
};

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model", { timeout: 20000 });
await page.evaluate(() => (window.__qaMarker = 1));
await injectShortsLeak(page);
const leakAt = await recheck(ctx);
const sLeak = await waitFor((s) => s.badge === "!" && s.entry?.ts > leakAt, 25000);
check("S1 search: visible Shorts link → '!' and html[data-er-health] = stored missing list", sLeak.badge === "!" && sLeak.entry?.missing.includes("shorts") && sLeak.attr === sLeak.entry.missing.join(","), sLeak);
await page.screenshot({ path: join(OUT, "HS-search-leak.png") });
await setSettings({ shortsMode: "show" });
const sOff = await waitFor((s) => s.badge !== "!" && s.attr === "ok", 15000);
check("S1 untick Shorts (shortsMode=show) while '!' shows → '!' cleared without navigation", sOff.badge !== "!" && sOff.attr === "ok" && sOff.entry?.missing.length === 0 && sOff.marker === 1 && sOff.url === sLeak.url, sOff);
check("S1 tooltip back to normal after the settings change", Boolean(sOff.title) && !/changed something/i.test(sOff.title), sOff.title);
await page.evaluate(() => document.getElementById("qa-leak")?.remove());
await setSettings({ shortsMode: "watch" });

const [video] = await searchVideoUrls(page, QUERY, 4);
const openedAt = Date.now();
await page.goto(video, { waitUntil: "domcontentloaded" });
await page.waitForSelector("ytd-watch-flexy #related", { state: "attached", timeout: 20000 });
const wBase = await waitFor((s) => s.entry?.ts > openedAt && s.entry.page === "watch" && s.attr !== null, 25000);
check("S2 watch baseline: no '!', html[data-er-health] = ok", wBase.entry?.page === "watch" && wBase.badge !== "!" && wBase.attr === "ok", wBase);
await page.evaluate(() => {
  window.__qaMarker = 1;
  document.querySelector("ytd-watch-flexy #related")?.remove();
});
const removedAt = Date.now();
await setSettings({ endPrompt: false });
const wLeak = await waitFor((s) => s.badge === "!" && s.entry?.ts > removedAt, 25000);
check("S2 watch: #related removed + unrelated settings change → '!' naming related, attr matches", wLeak.badge === "!" && wLeak.entry?.missing.includes("related") && wLeak.attr === wLeak.entry.missing.join(","), wLeak);
await page.screenshot({ path: join(OUT, "HS-watch-related-missing.png") });
await setSettings({ hide: { related: false } });
const wOff = await waitFor((s) => s.badge !== "!" && s.attr === "ok", 15000);
check("S2 untick Recommendations while '!' shows → '!' cleared without navigation", wOff.badge !== "!" && wOff.attr === "ok" && wOff.entry?.missing.length === 0 && wOff.marker === 1 && wOff.url === wLeak.url, wOff);
await page.screenshot({ path: join(OUT, "HS-watch-after-untick.png") });

await finish(ctx, check);
save("HS-health-settings.json");
await context.close();
