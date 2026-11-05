import { join } from "node:path";
import { launch, reporter, consent, sleep, heap, OUT, QUERY, closeWelcome } from "./harness.mjs";

const { check, save } = reporter();
const ONLY = (process.env.ONLY || "churn,settings,pause,strict").split(",");
const CYCLES = Number(process.env.CYCLES || 5);
const ctx = await launch({ name: "qa-release" });
const { context, errors } = ctx;
await closeWelcome(ctx);
const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await context.newPage());
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.stack || e).slice(0, 300)));

const tabId = async () => ctx.worker.evaluate(async () => {
  const { health = {} } = await chrome.storage.session.get("health");
  const latest = Object.entries(health).sort((a, b) => b[1].ts - a[1].ts)[0];
  return latest ? Number(latest[0]) : (await chrome.tabs.query({ active: true }))[0]?.id;
});
async function badge() {
  const id = await tabId();
  return ctx.worker.evaluate(async (tab) => {
    const { health = {} } = await chrome.storage.session.get("health");
    return { badge: await chrome.action.getBadgeText({ tabId: tab }), title: await chrome.action.getTitle({ tabId: tab }), globalTitle: await chrome.action.getTitle({}), globalBadge: await chrome.action.getBadgeText({}), entry: health[tab] ?? null };
  }, id);
}
const dom = () => page.evaluate(() => {
  const r = document.documentElement;
  const count = (s) => document.querySelectorAll(s).length;
  return {
    page: r.dataset.erPage,
    health: r.getAttribute("data-er-health"),
    strict: r.hasAttribute("data-er-strict"),
    showHome: r.hasAttribute("data-er-show-home"),
    showRelated: r.hasAttribute("data-er-show-related"),
    showComments: r.hasAttribute("data-er-show-comments"),
    intent: count("#er-intent"),
    pill: count("#er-pill"),
    reveal: count("#er-reveal"),
    comments: count("#er-comments"),
    erNodes: count("[id^='er-']"),
    attrs: [...r.attributes].filter((a) => a.name.startsWith("data-er-") && a.name !== "data-er-health").map((a) => a.name).join(","),
  };
});
const setStore = (obj) => ctx.worker.evaluate((o) => chrome.storage.local.set(o), obj);
const getStore = (keys) => ctx.worker.evaluate((k) => chrome.storage.local.get(k), keys);
const DEFAULTS = await ctx.worker.evaluate(() => globalThis.ErrandLib.DEFAULTS);

async function spa(href) {
  await page.evaluate((h) => {
    const a = document.createElement("a");
    a.href = h;
    a.className = "yt-simple-endpoint";
    document.querySelector("ytd-app")?.appendChild(a);
    a.click();
    a.remove();
  }, href);
}

async function settle(kind) {
  await page.waitForFunction((k) => document.documentElement.dataset.erPage === k, kind, { timeout: 15000 }).catch(() => {});
  await sleep(7500);
}

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await sleep(5000);

if (ONLY.includes("churn")) {
  const nav = [];
  const falseBang = [];
  const dup = [];
  const samples = [];
  samples.push({ step: 0, ...(await heap(page)) });
  let channelHref = null;
  for (let c = 0; c < CYCLES; c++) {
    if (c > 0) {
      await spa("/");
      await settle("home");
      const b = await badge();
      const d = await dom();
      nav.push({ c, step: "home", url: page.url(), ...d, badge: b.badge, missing: b.entry?.missing });
      if (b.badge === "!") falseBang.push({ c, step: "home", missing: b.entry?.missing });
    } else {
      const b = await badge();
      nav.push({ c, step: "home", url: page.url(), ...(await dom()), badge: b.badge, missing: b.entry?.missing });
      if (b.badge === "!") falseBang.push({ c, step: "home", missing: b.entry?.missing });
    }
    await page.locator("#er-intent input").fill(`${QUERY} ${c}`);
    await page.keyboard.press("Enter");
    await settle("search");
    let b = await badge();
    nav.push({ c, step: "search", url: page.url(), ...(await dom()), badge: b.badge, missing: b.entry?.missing });
    if (b.badge === "!") falseBang.push({ c, step: "search", missing: b.entry?.missing });
    const watchHref = await page.evaluate(() => document.querySelectorAll('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]')[0]?.getAttribute("href"));
    if (!watchHref) {
      check(`churn cycle ${c}: search returned a video`, false);
      continue;
    }
    await spa(watchHref);
    await settle("watch");
    b = await badge();
    nav.push({ c, step: "watch", url: page.url(), ...(await dom()), badge: b.badge, missing: b.entry?.missing });
    if (b.badge === "!") falseBang.push({ c, step: "watch", missing: b.entry?.missing });
    channelHref = (await page.evaluate(() => document.querySelector("ytd-video-owner-renderer a[href^='/@'], ytd-video-owner-renderer a[href^='/channel/']")?.getAttribute("href"))) || channelHref || "/@Apple";
    await spa(channelHref);
    await settle("channel");
    b = await badge();
    nav.push({ c, step: "channel", url: page.url(), ...(await dom()), badge: b.badge, missing: b.entry?.missing });
    if (b.badge === "!") falseBang.push({ c, step: "channel", missing: b.entry?.missing });
    await page.goBack();
    await settle("watch");
    b = await badge();
    nav.push({ c, step: "back-watch", url: page.url(), ...(await dom()), badge: b.badge, missing: b.entry?.missing });
    if (b.badge === "!") falseBang.push({ c, step: "back-watch", missing: b.entry?.missing });
    await page.goBack();
    await settle("search");
    b = await badge();
    nav.push({ c, step: "back-search", url: page.url(), ...(await dom()), badge: b.badge, missing: b.entry?.missing });
    if (b.badge === "!") falseBang.push({ c, step: "back-search", missing: b.entry?.missing });
    samples.push({ step: c + 1, ...(await heap(page)) });
  }
  await spa("/feed/subscriptions");
  await settle("subs");
  const sb = await badge();
  nav.push({ c: "end", step: "subs", url: page.url(), ...(await dom()), badge: sb.badge, missing: sb.entry?.missing });
  if (sb.badge === "!") falseBang.push({ c: "end", step: "subs", missing: sb.entry?.missing });
  const withEntry = nav.filter((n) => Array.isArray(n.missing)).length;
  check(`churn: badge read from the YouTube tab's own entry (${withEntry}/${nav.length} steps had a health entry)`, withEntry === nav.length);
  await page.screenshot({ path: join(OUT, "R-churn-subs.png") });
  for (const n of nav) {
    const expect = { "back-watch": "watch", "back-search": "search" }[n.step] || n.step;
    if (n.page !== expect) dup.push({ c: n.c, step: n.step, page: n.page, url: n.url });
    if (n.intent > 1 || n.pill > 1 || n.reveal > 1 || n.comments > 1) dup.push({ c: n.c, step: n.step, intent: n.intent, pill: n.pill, reveal: n.reveal, comments: n.comments });
    if ((n.page === "watch") && n.reveal !== 1) dup.push({ c: n.c, step: n.step, reveal: n.reveal });
  }
  const homeOk = nav.filter((n) => n.step === "home").every((n) => n.intent === 1 && !n.showHome);
  check(`churn: ${nav.length} SPA navigations, page type and injected UI correct each time`, dup.length === 0, dup.slice(0, 6));
  check("churn: home question present and feed hidden on every return", homeOk);
  check(`churn: no false '!' on home/search/watch/channel/subs (${nav.length} checks)`, falseBang.length === 0, falseBang.slice(0, 6));
  const first = samples[1] || samples[0];
  const last = samples.at(-1);
  const erMax = Math.max(...nav.map((n) => n.erNodes));
  const erFirst = Math.max(...nav.filter((n) => n.c === 0).map((n) => n.erNodes));
  check(`churn: Errand's own nodes bounded (max ${erMax} vs ${erFirst} in cycle 1); heap ${first.heapMB}→${last.heapMB} MB, nodes ${first.nodes}→${last.nodes}, listeners ${first.listeners}→${last.listeners}`, erMax <= erFirst + 1, samples);
  save("R-churn.json");
}

if (ONLY.includes("settings")) {
  const watchHref = await page.evaluate(() => document.querySelector('a[href^="/watch"]')?.getAttribute("href"));
  if (!page.url().includes("/watch")) {
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
    await sleep(4000);
    const href = await page.evaluate(() => document.querySelector('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]')?.getAttribute("href"));
    await spa(href || watchHref);
    await settle("watch");
  }
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 900 });
  await popup.goto(`chrome-extension://${ctx.extId}/popup.html`);
  await sleep(800);
  await page.bringToFront();
  const boxes = await popup.locator("#hide input[type=checkbox], #stopAutoplay, #endPrompt").count();
  const t0 = Date.now();
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < boxes; i++) await popup.locator("#hide input[type=checkbox], #stopAutoplay, #endPrompt").nth(i).click({ timeout: 3000 }).catch(() => {});
    for (const v of ["block", "show", "watch"]) await popup.selectOption("#shortsMode", v);
    for (const v of ["subs", "feed", "wl", "ask"]) await popup.selectOption("#homeTarget", v);
  }
  const churnMs = Date.now() - t0;
  await sleep(8000);
  const s = (await getStore("settings")).settings;
  const merged = { ...DEFAULTS, ...s, hide: { ...DEFAULTS.hide, ...(s?.hide || {}) } };
  const d = await dom();
  const b = await badge();
  check(`settings churn: ${boxes * 4} toggles + 28 selects in ${churnMs} ms; stored settings back to defaults`, JSON.stringify(merged.hide) === JSON.stringify(DEFAULTS.hide) && merged.shortsMode === DEFAULTS.shortsMode && merged.homeTarget === DEFAULTS.homeTarget, { hide: merged.hide, shorts: merged.shortsMode, home: merged.homeTarget });
  check("settings churn: open watch tab matches final settings (related/comments hidden, one reveal, one comments button)", d.page === "watch" && !d.showRelated && !d.showComments && d.reveal === 1 && d.comments <= 1, d);
  check("settings churn: no '!' after settling", b.badge !== "!", b);
  await popup.locator("#hide input[type=checkbox]").first().click();
  await sleep(1500);
  const d2 = await dom();
  await popup.locator("#hide input[type=checkbox]").first().click();
  await sleep(1500);
  const d3 = await dom();
  check("settings churn: a single toggle still takes effect live after churn", JSON.stringify(d2) !== JSON.stringify(d3), { after1: d2, after2: d3 });
  await popup.close();
  await page.screenshot({ path: join(OUT, "R-settings-churn-watch.png") });
  save("R-churn.json");
}

if (ONLY.includes("pause")) {
  await spa("/");
  await settle("home");
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 900 });
  await popup.goto(`chrome-extension://${ctx.extId}/popup.html`);
  await sleep(800);
  await popup.click("#pauseButton");
  await sleep(11500);
  const st = await getStore(["pausedUntil", "pauseStartsAt"]);
  const d = await dom();
  const g = await badge();
  check("pause via popup: after 10 s countdown pausedUntil ≈ now+15 min", st.pausedUntil && Math.abs(st.pausedUntil - Date.now() - 15 * 60e3) < 20e3, st);
  check("pause: open home tab shows the feed live, question hidden", d.showHome && !(await page.locator("#er-intent").isVisible()), d);
  check("pause: badge 'II'", g.globalBadge === "II", g);
  const btn = await popup.locator("#pauseButton").textContent();
  await popup.click("#pauseButton");
  await sleep(2000);
  const d2 = await dom();
  const g2 = await badge();
  check(`resume via popup ('${btn.trim()}'): question back, feed hidden, badge cleared`, !d2.showHome && (await page.locator("#er-intent").isVisible()) && g2.globalBadge === "", { d2, g2 });
  await setStore({ pausedUntil: Date.now() + 5000 });
  await sleep(1500);
  const d3 = await dom();
  await sleep(6000);
  const d4 = await dom();
  const g4 = await badge();
  const left = await getStore("pausedUntil");
  check("pause expiry with tab open: page resumes by itself, 'II' cleared, pausedUntil removed", d3.showHome && !d4.showHome && d4.intent === 1 && g4.globalBadge === "" && left.pausedUntil === undefined, { during: d3.showHome, after: d4.showHome, badge: g4.globalBadge, left });
  await popup.close();
}

if (ONLY.includes("strict")) {
  const hhmm = (ms) => {
    const t = new Date(ms);
    return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  };
  let now = Date.now();
  if (new Date(now).getSeconds() > 40) {
    await sleep((61 - new Date(now).getSeconds()) * 1000);
    now = Date.now();
  }
  const start = hhmm(now - 60e3);
  const end = hhmm(now + 60e3);
  const endMs = new Date(now + 60e3).setSeconds(0, 0);
  await setStore({ settings: { ...DEFAULTS, mode: "auto", strictStart: start, strictEnd: end, strictDays: [0, 1, 2, 3, 4, 5, 6] } });
  await spa("/");
  await settle("home");
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 900 });
  await popup.goto(`chrome-extension://${ctx.extId}/popup.html`);
  await sleep(800);
  await page.bringToFront();
  const pin = () => popup.evaluate(() => ({ status: document.getElementById("status").textContent, modeDisabled: document.getElementById("mode").disabled, pauseHidden: document.getElementById("pause").hidden, offHidden: document.getElementById("strictOff").hidden }));
  const p1 = await pin();
  const d1 = await dom();
  const g1 = await badge();
  check(`strict edge ${start}–${end}: inside the window the tab is strict, popup locked, Pause hidden`, d1.strict && p1.modeDisabled && p1.pauseHidden && !p1.offHidden, { p1, strict: d1.strict, title: g1.globalTitle });
  await setStore({ pauseStartsAt: Date.now() + 2000 });
  await sleep(3500);
  const ps = await getStore(["pauseStartsAt", "pausedUntil"]);
  check("strict edge: a pending pause is refused inside the window", ps.pausedUntil === undefined && ps.pauseStartsAt === undefined, ps);
  const wait = endMs - Date.now() + 2000;
  await sleep(Math.max(0, wait));
  const p2 = await pin();
  let flipMs = null;
  for (let i = 0; i < 70; i++) {
    if (!(await dom()).strict) {
      flipMs = Date.now() - endMs;
      break;
    }
    await sleep(1000);
  }
  const p3 = await pin();
  const g3 = await badge();
  check(`strict edge: open popup unlocks within ~1 s of ${end}`, !p2.modeDisabled && !p2.pauseHidden && p2.offHidden, p2);
  check("strict edge: open tab leaves strict within 61 s of the window end", flipMs !== null && flipMs <= 61000, { flipMs });
  check("strict edge: toolbar title no longer says strict after the window", !/strict/i.test(g3.globalTitle), { title: g3.globalTitle, p3 });
  await spa(`/results?search_query=${encodeURIComponent(QUERY)}`);
  await settle("search");
  const g4 = await badge();
  check("strict edge: toolbar title back to 'on' after the next navigation", !/strict/i.test(g4.globalTitle) && !/strict/i.test(g4.title), { title: g4.title, global: g4.globalTitle });
  await popup.screenshot({ path: join(OUT, "R-strict-edge-after.png") });
  await popup.close();
  await setStore({ settings: DEFAULTS });
}

await sleep(1000);
const swErrs = await ctx.worker.evaluate(() => globalThis.__errs || []).catch(() => ["worker gone"]);
check("console: no extension errors in page, popup, service worker", errors.length === 0 && swErrs.length === 0, { errors: errors.slice(0, 8), swErrs });
check("page: no uncaught errors from the extension", pageErrors.filter((e) => e.includes("chrome-extension://")).length === 0, pageErrors.filter((e) => e.includes("chrome-extension://")).slice(0, 5));
save("R-release.json");
await context.close();
