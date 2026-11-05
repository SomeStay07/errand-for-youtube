import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, consent, searchVideoUrls, storage, sleep, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-popup", port: 9381 });
const { context, extId } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();

const Y = context.pages()[0] || (await context.newPage());
const urls = await searchVideoUrls(Y, undefined, 4);
await Y.goto(urls[0], { waitUntil: "domcontentloaded" });
await sleep(7000);

const P = await context.newPage();
await P.setViewportSize({ width: 340, height: 900 });
await P.goto(`chrome-extension://${extId}/popup.html`);
await sleep(800);

const attrs = () => Y.evaluate(() => Object.fromEntries([...document.documentElement.attributes].filter((a) => a.name.startsWith("data-er")).map((a) => [a.name, a.value])));
const settings = async () => (await storage(ctx, "settings")).settings;
const storedAs = async (key, value) => {
  for (let i = 0; i < 40; i++) {
    const s = await settings();
    if (s[key] === value) return s;
    await sleep(50);
  }
  return settings();
};
const loadId = () => Y.evaluate(() => (window.__qaLoad ??= Math.random()));
const marker = await loadId();

async function waitAttr(name, present, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await attrs();
    if ((name in a) === present) return Date.now() - t0;
    await sleep(50);
  }
  return null;
}

const homeExpect = { ask: false, subs: false, wl: false, feed: true };
for (const value of ["subs", "wl", "feed", "ask"]) {
  await P.selectOption("#homeTarget", value);
  const ms = await waitAttr("data-er-show-home", homeExpect[value]);
  const s = await storedAs("homeTarget", value);
  check(`popup Home=${value}: stored and applied live on the open watch tab`, s.homeTarget === value && ms !== null, `stored=${s.homeTarget} data-er-show-home flip ${ms} ms`);
}

const H = await context.newPage();
const homeLanding = {};
for (const value of ["ask", "subs", "wl", "feed"]) {
  await P.selectOption("#homeTarget", value);
  await sleep(300);
  await H.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await consent(H);
  if (value === "subs") await H.waitForURL(/feed\/subscriptions/, { timeout: 10000 }).catch(() => {});
  if (value === "wl") await H.waitForURL(/list=WL/, { timeout: 10000 }).catch(() => {});
  await sleep(3500);
  const state = await H.evaluate(() => ({
    path: location.pathname + location.search,
    question: Boolean(document.getElementById("er-intent")?.getClientRects().length),
    feedShown: document.documentElement.hasAttribute("data-er-show-home"),
  }));
  homeLanding[value] = state;
  await H.screenshot({ path: join(OUT, `P-home-${value}.png`) });
}
check("Home=ask: youtube.com shows the question", homeLanding.ask.path === "/" && homeLanding.ask.question, homeLanding.ask);
check("Home=subs: youtube.com redirects to /feed/subscriptions", homeLanding.subs.path.startsWith("/feed/subscriptions"), homeLanding.subs);
check("Home=wl: youtube.com redirects to Watch later", homeLanding.wl.path === "/playlist?list=WL", homeLanding.wl);
check("Home=feed: youtube.com shows the feed, no question", homeLanding.feed.path === "/" && homeLanding.feed.feedShown && !homeLanding.feed.question, homeLanding.feed);
await P.selectOption("#homeTarget", "ask");

const shortsExpect = { watch: false, block: false, show: true };
for (const value of ["show", "block", "watch"]) {
  await P.selectOption("#shortsMode", value);
  const ms = await waitAttr("data-er-show-shorts", shortsExpect[value]);
  const s = await storedAs("shortsMode", value);
  check(`popup Shorts=${value}: stored and applied live`, s.shortsMode === value && ms !== null, `stored=${s.shortsMode} flip ${ms} ms`);
}

const hideRows = await P.evaluate(() => [...document.querySelectorAll("#hide label.row")].map((l) => l.textContent));
const HIDE = ["related", "endscreen", "comments"];
for (let i = 0; i < HIDE.length; i++) {
  const key = HIDE[i];
  const box = P.locator("#hide input").nth(i);
  await box.uncheck();
  const off = await waitAttr(`data-er-show-${key}`, true);
  const s1 = await settings();
  await box.check();
  const on = await waitAttr(`data-er-show-${key}`, false);
  const s2 = await settings();
  check(`popup "${hideRows[i]}" round-trip`, s1.hide[key] === false && s2.hide[key] === true && off !== null && on !== null, `untick: stored ${s1.hide[key]}, attr in ${off} ms; tick: stored ${s2.hide[key]}, attr in ${on} ms`);
}
const revealAfterToggle = await Y.evaluate(() => ({ reveal: document.querySelectorAll("#er-reveal").length, comments: document.querySelectorAll("#er-comments").length }));
check("watch tab keeps one reveal and one comments button after toggling", revealAfterToggle.reveal === 1 && revealAfterToggle.comments === 1, revealAfterToggle);

await P.uncheck("#stopAutoplay");
const ap1 = await waitAttr("data-er-no-autoplay", false);
const sa1 = await settings();
await P.check("#stopAutoplay");
const ap2 = await waitAttr("data-er-no-autoplay", true);
const sa2 = await settings();
check("popup autoplay checkbox round-trip", sa1.stopAutoplay === false && sa2.stopAutoplay === true && ap1 !== null && ap2 !== null, `${ap1} ms / ${ap2} ms`);
await P.uncheck("#endPrompt");
const se1 = await storedAs("endPrompt", false);
await P.check("#endPrompt");
const se2 = await storedAs("endPrompt", true);
check("popup end prompt checkbox round-trip (storage only)", se1.endPrompt === false && se2.endPrompt === true, `${se1.endPrompt} → ${se2.endPrompt}`);

await P.click("details > summary");
await sleep(200);
const MORE = ["chat", "notifications", "metrics", "thumbs"];
for (let i = 0; i < MORE.length; i++) {
  const key = MORE[i];
  const box = P.locator("#more input").nth(i);
  const initial = await box.isChecked();
  await box.check();
  const on = await waitAttr(`data-er-hide-${key}`, true);
  const s1 = await settings();
  await box.uncheck();
  const off = await waitAttr(`data-er-hide-${key}`, false);
  const s2 = await settings();
  check(`popup More "${key}" opt-in round-trip (default off)`, !initial && s1.hide[key] === true && s2.hide[key] === false && on !== null && off !== null, `${on} ms / ${off} ms`);
}
await P.locator("#more input").nth(2).check();
await waitAttr("data-er-hide-metrics", true);
await Y.screenshot({ path: join(OUT, "P-watch-metrics-hidden.png") });
const metricsState = await Y.evaluate(() => [...document.querySelectorAll("#owner-sub-count, ytd-watch-info-text #info > span:first-child")].map((n) => getComputedStyle(n).visibility));
check("metrics opt-in hides counts on the watch page", metricsState.length > 0 && metricsState.every((v) => v === "hidden"), metricsState);
await P.locator("#more input").nth(2).uncheck();

const hhmmAt = (ms) => new Date(ms).toTimeString().slice(0, 5);
await P.evaluate(async ({ start, end }) => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.mergeSettings(settings), mode: "relaxed", strictStart: start, strictEnd: end, strictDays: [0, 1, 2, 3, 4, 5, 6] } });
}, { start: hhmmAt(Date.now() - 3600e3), end: hhmmAt(Date.now() + 3600e3) });
await P.reload();
await sleep(800);
await P.selectOption("#mode", "auto");
const insideWindow = await waitAttr("data-er-strict", true, 3000);
const editable = await P.evaluate(() => ["mode", "strictStart", "strictEnd"].every((id) => !document.getElementById(id).disabled) && [...document.querySelectorAll("#days input")].every((b) => !b.disabled));
check("picking On a schedule inside the window leaves hours and days editable", insideWindow !== null && editable, { insideWindow, editable });
await P.selectOption("#mode", "relaxed");
for (let i = 0; i < 40 && (await settings()).mode !== "relaxed"; i++) await sleep(50);
await P.evaluate(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, strictStart: "09:00", strictEnd: "18:00", strictDays: [1, 2, 3, 4, 5] } });
});
await P.reload();
await sleep(800);
await P.selectOption("#mode", "auto");
await sleep(200);
const schedVisible = await P.evaluate(() => !document.getElementById("schedule").hidden);
await P.fill("#strictStart", "03:00");
await P.locator("#strictStart").dispatchEvent("change");
await P.fill("#strictEnd", "04:00");
await P.locator("#strictEnd").dispatchEvent("change");
const firstDay = await P.evaluate(() => document.querySelector("#days label").title);
await P.locator("#days input").first().click();
await sleep(300);
const sm = await settings();
check("strict schedule: select shows times/days, all stored", schedVisible && sm.mode === "auto" && sm.strictStart === "03:00" && sm.strictEnd === "04:00" && sm.strictDays.length === 6 && sm.strictDays.includes(0), { mode: sm.mode, start: sm.strictStart, end: sm.strictEnd, days: sm.strictDays, firstDayToggled: firstDay });
await P.selectOption("#mode", "strict");
const st = await waitAttr("data-er-strict", true);
const stButtons = await Y.evaluate(() => document.querySelectorAll("#er-reveal, #er-comments").length);
check("strict=always applies live: data-er-strict on, reveal/comments buttons removed", st !== null && stButtons === 0, `${st} ms, buttons=${stButtons}`);
await P.evaluate(() => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.DEFAULTS, homeTarget: "ask" } }));
await P.reload();
await sleep(600);
const unst = await waitAttr("data-er-strict", false, 2000);
const reb = await Y.evaluate(() => document.querySelectorAll("#er-reveal").length);
check("leaving strict restores reveal button live", unst !== null && reb === 1, `${unst} ms, reveal=${reb}`);

await P.selectOption("#homeTarget", "subs");
await P.selectOption("#shortsMode", "block");
await P.locator("#hide input").nth(2).uncheck();
await sleep(300);
await P.click("details > summary");
await sleep(200);
const [download] = await Promise.all([P.waitForEvent("download", { timeout: 5000 }).catch(() => null), P.click("#export")]);
let exported = null;
if (download) {
  const file = join(OUT, "P-export.json");
  await download.saveAs(file);
  exported = JSON.parse(readFileSync(file, "utf8"));
}
check("Export downloads errand-settings.json with current settings", download?.suggestedFilename() === "errand-settings.json" && exported?.errand === 1 && exported.settings.homeTarget === "subs" && exported.settings.shortsMode === "block" && exported.settings.hide.comments === false, `${download?.suggestedFilename()} ${JSON.stringify(exported?.settings).slice(0, 200)}`);

await P.evaluate(() => chrome.storage.local.set({ settings: globalThis.ErrandLib.DEFAULTS }));
await P.reload();
await sleep(500);
await P.click("details > summary");
await sleep(200);
const importFile = join(OUT, "P-import.json");
writeFileSync(importFile, JSON.stringify(exported || { errand: 1, settings: { homeTarget: "subs", shortsMode: "block", hide: { comments: false } } }));
await P.setInputFiles("#import", importFile);
await sleep(1500);
const imported = await settings();
const ui = await P.evaluate(() => ({ home: document.getElementById("homeTarget").value, shorts: document.getElementById("shortsMode").value, comments: document.querySelectorAll("#hide input")[2].checked }));
check("Import restores settings and the popup reflects them", imported.homeTarget === "subs" && imported.shortsMode === "block" && imported.hide.comments === false && ui.home === "subs" && ui.shorts === "block" && !ui.comments, { imported: { home: imported.homeTarget, shorts: imported.shortsMode, comments: imported.hide.comments }, ui });
const bad = join(OUT, "P-import-bad.json");
writeFileSync(bad, "{not json");
await P.setInputFiles("#import", bad);
await sleep(800);
const badStatus = await P.textContent("#status");
const afterBad = await settings();
check("Import of a broken file shows a message and keeps settings", /import|read/i.test(badStatus) && afterBad.homeTarget === "subs", `status="${badStatus}"`);
const pathlog = await Y.evaluate(() => location.pathname);

const [welcome] = await Promise.all([context.waitForEvent("page", { timeout: 5000 }).catch(() => null), P.click("#lookAgain")]);
await sleep(800);
const wurl = welcome?.url() || "";
const wchecked = welcome ? await welcome.evaluate(() => document.querySelector('input[name="preset"]:checked')?.value ?? null) : null;
check('"Choose a look again" opens welcome.html in a new tab', wurl.endsWith("/welcome.html"), `${wurl} checked=${wchecked} (settings home=subs, shorts=block, comments shown → no preset matches)`);

const reloadLine = welcome ? await welcome.evaluate(() => {
  const node = document.querySelector('[data-i18n="welcomeReloadOpen"]');
  return node && node.getClientRects().length > 0 ? node.textContent : null;
}) : null;
const permissions = await welcome?.evaluate(() => chrome.runtime.getManifest().permissions ?? []);
check("welcome: reload line always shown, no tabs permission", Boolean(reloadLine) && !permissions?.includes("tabs"), { reloadLine, permissions, marker: marker !== undefined, path: pathlog });
if (welcome) {
  await welcome.locator('label.choice:has(input[value="ask"])').click();
  await sleep(300);
  const s = await settings();
  check("welcome after import: picking a preset overwrites the look, keeps opt-ins", s.homeTarget === "ask" && s.shortsMode === "watch" && s.hide.comments === true, { home: s.homeTarget, shorts: s.shortsMode, comments: s.hide.comments });
  await welcome.screenshot({ path: join(OUT, "P-welcome-lookagain.png"), fullPage: true });
}

const swErrs = await ctx.worker.evaluate(() => globalThis.__errs || []);
const errors = [...ctx.errors, ...swErrs];
check("no extension errors (page, popup, SW)", errors.length === 0, errors);
save("P-popup-results.json");
await context.close();
