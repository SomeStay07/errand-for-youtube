import { join } from "node:path";
import { launch, reporter, consent, sleep, until, closeWelcome, healthOf, recheck, settingsApi, finish, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-pages" });
const { context } = ctx;
await closeWelcome(ctx);
const page = context.pages()[0] || (await context.newPage());
const W = ctx.worker;
const { set: setSettings, preset } = settingsApi(ctx);
const health = () => healthOf(ctx);
const reportAfter = async (at, ms = 20000) => (await until(health, (h) => h.entry?.ts > at, ms, 500)).value;
const verdict = async () => reportAfter(await recheck(ctx));
const SHORTS_ALLOWED = "#description, ytd-text-inline-expander, ytd-comments, #er-intent";
const scan = () => page.evaluate((allowed) => {
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";
  const guide = document.querySelector('ytd-guide-entry-renderer a[href^="/shorts"], ytd-mini-guide-entry-renderer a[href^="/shorts"]');
  const label = (guide?.getAttribute("title") || guide?.textContent || "").trim().toLowerCase();
  const isShorts = (text) => {
    const t = String(text || "").trim().toLowerCase();
    return t === "shorts" || (Boolean(label) && t === label);
  };
  return {
    path: location.pathname + location.search,
    erPage: document.documentElement.dataset.erPage,
    shortsLinks: [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => vis(a) && !a.closest(allowed)).length,
    shortsLinksTotal: document.querySelectorAll('a[href^="/shorts/"]').length,
    shortsChips: [...document.querySelectorAll("yt-chip-cloud-chip-renderer, chip-view-model, yt-chip-cloud-chip-renderer button")].filter((c) => vis(c) && isShorts(c.textContent)).length,
    shortsTabs: [...document.querySelectorAll("yt-tab-shape, tp-yt-paper-tab")].filter((t) => vis(t) && isShorts(t.getAttribute("tab-title") || t.textContent)).length,
    guideLabel: label,
    reelShelves: [...document.querySelectorAll("ytd-reel-shelf-renderer, grid-shelf-view-model, ytd-rich-shelf-renderer[is-shorts]")].filter(vis).length,
    videos: [...document.querySelectorAll("ytd-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer")].filter(vis).length,
    mixes: [...document.querySelectorAll('ytd-radio-renderer, yt-lockup-view-model:has(a[href*="start_radio=1"])')].filter(vis).length,
    related: Boolean([...document.querySelectorAll("ytd-watch-flexy #related")].some(vis)),
    relatedItems: [...document.querySelectorAll("ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-flexy #related ytd-compact-video-renderer")].filter(vis).length,
    relatedShorts: [...document.querySelectorAll('ytd-watch-flexy #related a[href^="/shorts/"]')].filter(vis).length,
    playlistAttr: document.documentElement.hasAttribute("data-er-playlist"),
    pill: document.getElementById("er-pill")?.getClientRects().length ? document.getElementById("er-pill").textContent : null,
    pillLink: (() => {
      const a = document.querySelector("#er-pill a");
      return a ? { href: a.getAttribute("href"), text: a.textContent, title: a.getAttribute("title"), aria: a.getAttribute("aria-label") } : null;
    })(),
    pillButtons: document.querySelectorAll("#er-pill button").length,
    footnote: document.querySelector("#er-intent .er-footnote")?.textContent ?? null,
    question: Boolean(document.getElementById("er-intent")?.getClientRects().length),
    focused: document.activeElement?.closest?.("#er-intent") ? "intent" : document.activeElement?.tagName,
  };
}, SHORTS_ALLOWED);

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await page.reload({ waitUntil: "domcontentloaded" });
await sleep(4000);
const home = await scan();
await page.screenshot({ path: join(OUT, "G-home.png") });
const homeFeed = await page.evaluate(() => {
  const browse = document.querySelector('ytd-browse[page-subtype="home"]');
  return { attached: Boolean(browse), visible: Boolean(browse?.getClientRects().length) };
});
check("home: question shown, feed rendered and hidden, input focused", home.question && home.focused === "intent" && homeFeed.attached && !homeFeed.visible, { ...home, homeFeed });
const msg = (key, ...subs) => W.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs]);
const footerAny = await msg("intentFooterAny");
check("B5 headless Chrome for Testing (no 'Google Chrome' brand): footnote = intentFooterAny, question keeps focus", Boolean(footerAny) && home.footnote === footerAny && home.focused === "intent", { footnote: home.footnote, footerAny });
const f3 = await page.evaluate(async () => {
  const input = document.querySelector('yt-searchbox input[name="search_query"]');
  const box = document.querySelector("yt-searchbox .ytSearchboxComponentSuggestionsContainer");
  if (!input || !box) return { input: Boolean(input), box: Boolean(box) };
  const area = document.createElement("textarea");
  area.name = "search_query";
  area.placeholder = "Search";
  input.replaceWith(area);
  box.hidden = false;
  box.style.display = "block";
  const child = document.createElement("div");
  child.style.height = "20px";
  box.append(child);
  const height = () => Math.round(box.getBoundingClientRect().height);
  const empty = height();
  area.value = "a";
  await new Promise((r) => requestAnimationFrame(r));
  const typed = height();
  area.replaceWith(input);
  child.remove();
  box.removeAttribute("style");
  return { empty, typed };
});
check("F3 textarea search box: empty → suggestions container height 0, typed → visible", f3.empty === 0 && f3.typed > 0, f3);
let h = await verdict();
check("health home: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);

await page.locator("#er-intent input").fill(QUERY);
await page.keyboard.press("Enter");
await page.waitForURL(/results/, { timeout: 20000 });
await sleep(5000);
const s1 = await scan();
const intent = await W.evaluate(() => chrome.storage.local.get("intent"));
await page.screenshot({ path: join(OUT, "G-search-pill.png") });
check("home question → search: intent stored, pill visible", intent.intent?.text === QUERY && s1.pill?.includes(QUERY), { pill: s1.pill, intent: intent.intent });
const firstWatch = await page.evaluate(() => document.querySelector('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]')?.getAttribute("href"));
await page.goto(`https://www.youtube.com${firstWatch}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#er-pill a", { timeout: 15000 }).catch(() => {});
const pw = await scan();
const resultsPath = `/results?search_query=${encodeURIComponent(QUERY)}`;
const pillBack = await msg("pillBack", QUERY);
check("P1 watch page: pill label is a link to the results for the errand, × is the only button", pw.pillLink?.href === resultsPath && pw.pillLink.text === (await msg("pillLabel", QUERY)) && pw.pillButtons === 1, { pillLink: pw.pillLink, pillButtons: pw.pillButtons, url: page.url() });
check("P1 pill link title = pillBack, no aria-label (accessible name is the visible label)", Boolean(pillBack) && pw.pillLink?.title === pillBack && pw.pillLink.aria === null, { pillLink: pw.pillLink, pillBack });
await page.locator("#er-pill a").focus();
await page.keyboard.press("Enter");
await page.waitForURL(/\/results\?search_query=/, { timeout: 15000 }).catch(() => {});
await sleep(3000);
const pBack = await scan();
check("P1 Enter on the pill link → results for the errand, pill still there", new URL(page.url()).pathname === "/results" && new URL(page.url()).searchParams.get("search_query") === QUERY && Boolean(pBack.pill), { url: page.url(), pill: pBack.pill });
check(`search "${QUERY}": no visible Shorts, no Shorts chip`, s1.shortsLinks === 0 && s1.shortsChips === 0 && s1.reelShelves === 0 && s1.videos > 5, s1);
h = await verdict();
check("health search: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);
await page.locator("#er-pill button").click();
const { value: pillGone } = await until(scan, (x) => x.pill === null, 3000, 100);
const intentGone = await W.evaluate(() => chrome.storage.local.get("intent"));
check("pill × clears the errand", pillGone.pill === null && intentGone.intent === undefined, { pill: pillGone.pill });

let shortsId = null;
for (const q of ["minecraft", "how to tie a tie", "funny cats"]) {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("ytd-video-renderer, yt-lockup-view-model", { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  await page.mouse.wheel(0, 3000);
  await sleep(2500);
  const s = await scan();
  shortsId ??= await page.evaluate(() => [...document.querySelectorAll('a[href^="/shorts/"]')].map((a) => /^\/shorts\/([\w-]{6,})/.exec(a.getAttribute("href"))?.[1]).find(Boolean) ?? null);
  await page.screenshot({ path: join(OUT, `G-search-${q.replace(/\W+/g, "-")}.png`) });
  check(`search "${q}" (default): no visible Shorts links/shelves/chips, results present`, s.shortsLinks === 0 && s.shortsChips === 0 && s.reelShelves === 0 && s.videos > 5, s);
}
h = await verdict();
check("health search after scroll: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);

await page.goto("https://www.youtube.com/@mkbhd", { waitUntil: "domcontentloaded" });
await sleep(6000);
const ch = await scan();
await page.screenshot({ path: join(OUT, "G-channel.png") });
check("channel page: Shorts tab hidden, no visible Shorts", ch.shortsTabs === 0 && ch.shortsLinks === 0 && ch.erPage === "channel", ch);
h = await verdict();
check("health channel: no false '!' (channel has no checks; entry must be clean)", h.badge !== "!" && h.entry?.page === "channel" && h.entry.missing.length === 0, h);
await page.goto("https://www.youtube.com/@mkbhd/videos", { waitUntil: "domcontentloaded" });
await sleep(5000);
const chv = await scan();
check("channel Videos tab: grid present, no Shorts", chv.videos > 5 && chv.shortsLinks === 0 && chv.shortsTabs === 0, chv);
await page.goto("https://www.youtube.com/@mkbhd/shorts", { waitUntil: "domcontentloaded" });
await sleep(5000);
const chs = await scan();
await page.screenshot({ path: join(OUT, "G-channel-shorts-url.png") });
check("channel /shorts URL typed directly: no visible Shorts items (observation)", chs.shortsLinks === 0, chs);

h = await reportAfter(await (async () => {
  const at = Date.now();
  await page.goto("https://www.youtube.com/feed/subscriptions", { waitUntil: "domcontentloaded" });
  return at;
})());
await page.screenshot({ path: join(OUT, "G-subs-signed-out.png") });
check("health subscriptions (signed out): no false '!'", h.badge !== "!" && h.entry?.page === "subs" && h.entry.missing.length === 0, h);

if (shortsId) {
  await page.goto(`https://www.youtube.com/shorts/${shortsId}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/watch\?v=/, { timeout: 15000 }).catch(() => {});
  check("Shorts URL (watch mode) → /watch", page.url().includes(`/watch?v=${shortsId}`), page.url());
  h = await verdict();
  check("health watch: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);
  const navBefore = page.url();
  await page.evaluate((id) => {
    const a = document.createElement("a");
    a.href = `/shorts/${id}`;
    a.textContent = "qa";
    document.querySelector("ytd-app").append(a);
    a.click();
  }, shortsId);
  await page.waitForURL(/\/watch\?v=/, { timeout: 8000 }).catch(() => {});
  check("click on a /shorts/ link (watch mode) opens /watch, not the Shorts player", page.url().includes(`/watch?v=${shortsId}`), `${navBefore} → ${page.url()}`);
  await setSettings({ shortsMode: "block" });
  await sleep(300);
  await page.goto(`https://www.youtube.com/shorts/${shortsId}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  const blocked = await scan();
  check("Shorts URL (block mode) → home with the question", new URL(page.url()).pathname === "/" && blocked.question, blocked);
  await setSettings({ shortsMode: "show" });
  await sleep(300);
  await page.goto(`https://www.youtube.com/shorts/${shortsId}`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  check("Shorts URL (show mode) stays on /shorts/", page.url().includes(`/shorts/${shortsId}`), page.url());
  await setSettings({ shortsMode: "watch" });
} else {
  check("Shorts redirect", null, "precondition: no /shorts/ link found in 3 searches");
}

const firstVideo = async (q) => {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[href^="/watch"]', { state: "attached", timeout: 20000 });
  await sleep(3000);
  return page.evaluate(() => [...document.querySelectorAll('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]')].map((a) => new URL(a.href).searchParams.get("v")).find(Boolean));
};
const vid = await firstVideo("lofi hip hop");
await page.goto(`https://www.youtube.com/watch?v=${vid}&list=RD${vid}&start_radio=1`, { waitUntil: "domcontentloaded" });
await sleep(7000);
const mix = await scan();
await page.screenshot({ path: join(OUT, "G-mix.png") });
check("Mix (RD list): not treated as playlist (end prompt/autoplay-off apply), related hidden", !mix.playlistAttr && !mix.related && mix.erPage === "watch", mix);
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("python tutorial playlist")}&sp=EgIQAw%253D%253D`, { waitUntil: "domcontentloaded" });
await sleep(5000);
const plHref = await page.evaluate(() => [...document.querySelectorAll('a[href*="list=PL"]')].map((a) => a.getAttribute("href")).find((h) => h.includes("watch") || h.includes("playlist")));
const listId = plHref ? new URLSearchParams(plHref.split("?")[1]).get("list") : null;
if (listId) {
  await page.goto(`https://www.youtube.com/playlist?list=${listId}`, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  const plPage = await scan();
  const firstInList = await page.evaluate(() => document.querySelector('ytd-playlist-video-renderer a#thumbnail[href*="list="], a[href*="/watch"][href*="list="]')?.getAttribute("href"));
  await page.screenshot({ path: join(OUT, "G-playlist-page.png") });
  check("playlist page: videos listed, erPage=playlist", plPage.erPage === "playlist" && Boolean(firstInList), { erPage: plPage.erPage, firstInList });
  if (firstInList) {
    await page.goto(`https://www.youtube.com${firstInList}`, { waitUntil: "domcontentloaded" });
    await sleep(7000);
    const pl = await scan();
    const panel = await page.evaluate(() => Boolean([...document.querySelectorAll("ytd-playlist-panel-renderer")].some((n) => n.getClientRects().length)));
    await page.screenshot({ path: join(OUT, "G-playlist-watch.png") });
    check("real playlist watch: data-er-playlist on, playlist panel visible", pl.playlistAttr && panel && pl.erPage === "watch", { ...pl, panel });
  }
} else check("real playlist", null, "precondition: no PL playlist found in search");

await preset("shorts");
const g1 = [];
for (const q of ["minecraft", "how to tie a tie", "music video", "gaming highlights", "how to fix a bike"]) {
  const v = await firstVideo(q);
  const s = await scan();
  g1.push({ q, kind: "search", shortsLinks: s.shortsLinks, shelves: s.reelShelves, videos: s.videos });
  if (["music video", "gaming highlights", "how to fix a bike"].includes(q)) {
    await page.goto(`https://www.youtube.com/watch?v=${v}`, { waitUntil: "domcontentloaded" });
    await sleep(7000);
    await page.mouse.wheel(0, 2500);
    await sleep(2500);
    const w = await scan();
    g1.push({ q, kind: "watch", shortsLinks: w.shortsLinks, relatedShorts: w.relatedShorts, relatedItems: w.relatedItems, related: w.related });
    const hw = await verdict();
    g1.at(-1).badge = hw.badge;
    g1.at(-1).missing = hw.entry?.missing;
    g1.at(-1).attr = await page.evaluate(() => document.documentElement.getAttribute("data-er-health"));
    g1.at(-1).playable = await page.evaluate(() => Number.isFinite(document.querySelector("video.html5-main-video")?.duration));
  }
}
const fixtureHeights = () =>
  page.evaluate(() => Object.fromEntries(["qa-lockup", "qa-watchplay", "qa-playables"].map((id) => [id, Math.round(document.getElementById(id)?.getBoundingClientRect().height ?? -1)])));
await page.goto(page.url(), { waitUntil: "domcontentloaded" });
await page.waitForSelector("ytd-watch-flexy #related", { state: "attached", timeout: 20000 }).catch(() => {});
await page.evaluate(() => {
  const related = document.querySelector("ytd-watch-flexy #related");
  const lockup = document.createElement("yt-lockup-view-model");
  lockup.id = "qa-lockup";
  lockup.style.cssText = "display:block;height:40px";
  const a = document.createElement("a");
  a.href = "/shorts/qaLockup1";
  a.textContent = "qa lockup";
  lockup.append(a);
  const play = document.createElement("ytd-horizontal-card-list-renderer");
  play.id = "qa-watchplay";
  play.style.cssText = "display:block;height:40px";
  related?.prepend(lockup, play);
});
const { value: f1Hidden } = await until(fixtureHeights, (x) => x["qa-lockup"] === 0 && x["qa-watchplay"] === 0, 2000, 100);
const f1Health = await verdict();
check("F1/S1 'Just hide Shorts' watch: Shorts lockup and Watch & Play in #related height 0, health verdict without '!'", f1Hidden["qa-lockup"] === 0 && f1Hidden["qa-watchplay"] === 0 && Boolean(f1Health.entry) && f1Health.badge !== "!", { f1Hidden, f1Health });
await setSettings({ shortsMode: "show" });
const { value: f1Shown } = await until(fixtureHeights, (x) => x["qa-lockup"] > 0 && x["qa-watchplay"] > 0, 3000, 100);
check("F1/S1 shortsMode=show: the same lockup and Watch & Play visible", f1Shown["qa-lockup"] > 0 && f1Shown["qa-watchplay"] > 0, f1Shown);
await setSettings({ shortsMode: "watch" });
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('ytd-browse[page-subtype="home"]', { state: "attached", timeout: 20000 }).catch(() => {});
await sleep(2500);
const s1Card = await page.evaluate(async () => {
  const section = document.createElement("ytd-rich-section-renderer");
  section.id = "qa-playables";
  section.style.cssText = "display:block;height:40px";
  (document.querySelector('ytd-browse[page-subtype="home"] #contents') || document.querySelector("ytd-app")).prepend(section);
  await new Promise((r) => setTimeout(r, 300));
  section.append(document.createElement("ytd-mini-game-card-view-model"));
  await new Promise((r) => setTimeout(r, 300));
  return Boolean(section.querySelector("ytd-mini-game-card-view-model"));
});
const { value: s1Hidden } = await until(fixtureHeights, (x) => x["qa-playables"] === 0, 2000, 100);
await setSettings({ shortsMode: "show" });
const { value: s1Shown } = await until(fixtureHeights, (x) => x["qa-playables"] > 0, 3000, 100);
await setSettings({ shortsMode: "watch" });
check("S1 home Playables shelf: hidden with Shorts, visible with shortsMode=show", s1Hidden["qa-playables"] === 0 && s1Shown["qa-playables"] > 0, { s1Card, s1Hidden, s1Shown });
await page.screenshot({ path: join(OUT, "G1-shorts-preset-watch.png") });
check("G1 preset 'Just hide Shorts': 3 watch + 2+ searches, zero visible Shorts, column has normal videos", g1.every((x) => x.shortsLinks === 0 && (x.kind === "search" ? x.videos > 5 && x.shelves === 0 : x.related && x.relatedItems > 3)), g1);
check("G2 (automated part) preset 'Just hide Shorts': no '!' on those watch pages", g1.filter((x) => x.kind === "watch").every((x) => x.badge !== "!"), g1.filter((x) => x.kind === "watch"));
check("G2 preset 'Just hide Shorts': html[data-er-health] = ok on those watch pages", g1.filter((x) => x.kind === "watch").every((x) => x.attr === "ok"), g1.filter((x) => x.kind === "watch").map((x) => ({ q: x.q, attr: x.attr, playable: x.playable })));
await preset("ask");

await page.goto(`https://www.youtube.com/results?search_query=minecraft`, { waitUntil: "domcontentloaded" });
await sleep(5000);
const total = await page.evaluate(() => document.querySelectorAll('a[href^="/shorts/"]').length);
await page.addStyleTag({ content: `html:not([data-er-show-shorts]):not(#qa-a):not(#qa-b) :is(ytd-reel-shelf-renderer, grid-shelf-view-model, ytd-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, yt-lockup-view-model, ytd-shelf-renderer, ytd-horizontal-card-list-renderer, [data-er-shorts]) { display: block !important; }` });
await page.locator('[name="search_query"]').first().fill("minecraft shorts");
await page.locator('[name="search_query"]').first().press("Enter");
const leakNavAt = Date.now();
await page.waitForURL(/minecraft\+shorts|minecraft%20shorts/, { timeout: 15000 }).catch(() => {});
({ value: h } = await until(health, (x) => x.badge === "!" && x.entry?.ts > leakNavAt, 25000, 500));
const leak = await scan();
await page.screenshot({ path: join(OUT, "G-forced-leak.png") });
check("forced Shorts leak + SPA navigation → '!' with 'shorts'", h.badge === "!" && h.entry?.missing.includes("shorts"), { leakLinks: leak.shortsLinks, shortsAnchorsBefore: total, h });

const titleOf = (id) => W.evaluate((i) => chrome.action.getTitle({ tabId: i }), Number(id));
const leakTitle = h.tab ? await titleOf(h.tab) : null;
const healAt = Date.now();
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
const healed = await reportAfter(healAt, 25000);
const healedTitle = healed.tab ? await titleOf(healed.tab) : null;
const swNow = await W.evaluate(() => globalThis.__errs || []);
check("after the leak is gone (reload, clean search): badge cleared, popup entry and tooltip back to OK", healed.badge !== "!" && healed.entry?.missing.length === 0 && healed.entry.ts > healAt && healedTitle !== leakTitle, { healed, leakTitle, healedTitle, swErrs: swNow });

await finish(ctx, check, { name: "no extension errors (page, SW)" });
save("G-pages-results.json");
await context.close();
