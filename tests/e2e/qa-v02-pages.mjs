import { join } from "node:path";
import { launch, reporter, consent, sleep, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-pages", port: 9385 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
const W = ctx.worker;
const setSettings = (patch) => W.evaluate((p) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.mergeSettings(settings), ...p } })), patch);
const health = async () => {
  const { health: h = {} } = await W.evaluate(() => chrome.storage.session.get("health"));
  const [id, entry] = Object.entries(h).sort((a, b) => b[1].ts - a[1].ts)[0] || [];
  return { tab: id, entry: entry ? { ...entry, age: Date.now() - entry.ts } : null, badge: id ? await W.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), Number(id)) : null };
};
const SHORTS_ALLOWED = "#description, ytd-text-inline-expander, ytd-comments, #er-intent";
const scan = () => page.evaluate((allowed) => {
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";
  return {
    path: location.pathname + location.search,
    erPage: document.documentElement.dataset.erPage,
    shortsLinks: [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => vis(a) && !a.closest(allowed)).length,
    shortsLinksTotal: document.querySelectorAll('a[href^="/shorts/"]').length,
    shortsChips: [...document.querySelectorAll("yt-chip-cloud-chip-renderer, chip-view-model, yt-chip-cloud-chip-renderer button")].filter((c) => vis(c) && c.textContent.trim().toLowerCase() === "shorts").length,
    shortsTabs: [...document.querySelectorAll("yt-tab-shape, tp-yt-paper-tab")].filter((t) => vis(t) && (t.getAttribute("tab-title") || t.textContent).trim().toLowerCase() === "shorts").length,
    reelShelves: [...document.querySelectorAll("ytd-reel-shelf-renderer, grid-shelf-view-model, ytd-rich-shelf-renderer[is-shorts]")].filter(vis).length,
    videos: [...document.querySelectorAll("ytd-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer")].filter(vis).length,
    mixes: [...document.querySelectorAll('ytd-radio-renderer, yt-lockup-view-model:has(a[href*="start_radio=1"])')].filter(vis).length,
    related: Boolean([...document.querySelectorAll("ytd-watch-flexy #related")].some(vis)),
    relatedItems: [...document.querySelectorAll("ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-flexy #related ytd-compact-video-renderer")].filter(vis).length,
    relatedShorts: [...document.querySelectorAll('ytd-watch-flexy #related a[href^="/shorts/"]')].filter(vis).length,
    playlistAttr: document.documentElement.hasAttribute("data-er-playlist"),
    pill: document.getElementById("er-pill")?.getClientRects().length ? document.getElementById("er-pill").textContent : null,
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
check("home: question shown, feed hidden, input focused", home.question && home.focused === "intent" && !(await page.evaluate(() => document.querySelector('ytd-browse[page-subtype="home"]')?.getClientRects().length)), home);
await sleep(5000);
let h = await health();
check("health home: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);

await page.locator("#er-intent input").fill(QUERY);
await page.keyboard.press("Enter");
await page.waitForURL(/results/, { timeout: 20000 });
await sleep(5000);
const s1 = await scan();
const intent = await W.evaluate(() => chrome.storage.local.get("intent"));
await page.screenshot({ path: join(OUT, "G-search-pill.png") });
check("home question → search: intent stored, pill visible", intent.intent?.text === QUERY && s1.pill?.includes(QUERY), { pill: s1.pill, intent: intent.intent });
check(`search "${QUERY}": no visible Shorts, no Shorts chip`, s1.shortsLinks === 0 && s1.shortsChips === 0 && s1.reelShelves === 0 && s1.videos > 5, s1);
await sleep(3000);
h = await health();
check("health search: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);
await page.locator("#er-pill button").click();
await sleep(600);
const pillGone = await scan();
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
await sleep(4000);
h = await health();
check("health search after scroll: no false '!'", h.badge !== "!" && h.entry?.missing.length === 0, h);

await page.goto("https://www.youtube.com/@mkbhd", { waitUntil: "domcontentloaded" });
await sleep(6000);
const ch = await scan();
await page.screenshot({ path: join(OUT, "G-channel.png") });
check("channel page: Shorts tab hidden, no visible Shorts", ch.shortsTabs === 0 && ch.shortsLinks === 0 && ch.erPage === "channel", ch);
await sleep(3000);
h = await health();
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

await page.goto("https://www.youtube.com/feed/subscriptions", { waitUntil: "domcontentloaded" });
await sleep(9000);
h = await health();
await page.screenshot({ path: join(OUT, "G-subs-signed-out.png") });
check("health subscriptions (signed out): no false '!'", h.badge !== "!" && h.entry?.page === "subs" && h.entry.missing.length === 0, h);

if (shortsId) {
  await page.goto(`https://www.youtube.com/shorts/${shortsId}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/watch\?v=/, { timeout: 15000 }).catch(() => {});
  check("Shorts URL (watch mode) → /watch", page.url().includes(`/watch?v=${shortsId}`), page.url());
  await sleep(8000);
  h = await health();
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
  check("Shorts redirect", null, "no /shorts/ link found in 3 searches");
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
} else check("real playlist", null, "no PL playlist found in search");

await setSettings({ ...(await W.evaluate(() => globalThis.ErrandLib.applyPreset({}, "shorts"))) });
await sleep(400);
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
    await sleep(2000);
    const hw = await health();
    g1.at(-1).badge = hw.badge;
    g1.at(-1).missing = hw.entry?.missing;
    g1.at(-1).attr = await page.evaluate(() => document.documentElement.getAttribute("data-er-health"));
    g1.at(-1).playable = await page.evaluate(() => Number.isFinite(document.querySelector("video.html5-main-video")?.duration));
  }
}
await page.screenshot({ path: join(OUT, "G1-shorts-preset-watch.png") });
check("G1 preset 'Just hide Shorts': 3 watch + 2+ searches, zero visible Shorts, column has normal videos", g1.every((x) => x.shortsLinks === 0 && (x.kind === "search" ? x.videos > 5 && x.shelves === 0 : x.related && x.relatedItems > 3)), g1);
check("G2 (automated part) preset 'Just hide Shorts': no '!' on those watch pages", g1.filter((x) => x.kind === "watch").every((x) => x.badge !== "!"), g1.filter((x) => x.kind === "watch"));
check("G2 preset 'Just hide Shorts': html[data-er-health] = ok on those watch pages", g1.filter((x) => x.kind === "watch").every((x) => x.attr === "ok"), g1.filter((x) => x.kind === "watch").map((x) => ({ q: x.q, attr: x.attr, playable: x.playable })));
await setSettings(await W.evaluate(() => globalThis.ErrandLib.applyPreset({}, "ask")));
await sleep(400);

await page.goto(`https://www.youtube.com/results?search_query=minecraft`, { waitUntil: "domcontentloaded" });
await sleep(5000);
const total = await page.evaluate(() => document.querySelectorAll('a[href^="/shorts/"]').length);
await page.addStyleTag({ content: `html:not([data-er-show-shorts]):not([data-qa]):not([data-qb]) :is(ytd-reel-shelf-renderer, grid-shelf-view-model, ytd-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, [data-er-shorts]) { display: block !important; }` });
await page.locator('input[name="search_query"]').first().fill("minecraft shorts");
await page.locator('input[name="search_query"]').first().press("Enter");
await page.waitForURL(/minecraft\+shorts|minecraft%20shorts/, { timeout: 15000 }).catch(() => {});
await sleep(9000);
const leak = await scan();
h = await health();
await page.screenshot({ path: join(OUT, "G-forced-leak.png") });
check("forced Shorts leak + SPA navigation → '!' with 'shorts'", h.badge === "!" && h.entry?.missing.includes("shorts"), { leakLinks: leak.shortsLinks, shortsAnchorsBefore: total, h });

const titleOf = (id) => W.evaluate((i) => chrome.action.getTitle({ tabId: i }), Number(id));
const leakTitle = h.tab ? await titleOf(h.tab) : null;
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await sleep(10000);
const healed = await health();
const healedTitle = healed.tab ? await titleOf(healed.tab) : null;
const swNow = await W.evaluate(() => globalThis.__errs || []);
check("after the leak is gone (reload, clean search): badge cleared, popup entry and tooltip back to OK", healed.badge !== "!" && healed.entry?.missing.length === 0 && healed.entry?.age < 6000 && healedTitle !== leakTitle, { healed, leakTitle, healedTitle, swErrs: swNow });

const swErrs = await W.evaluate(() => globalThis.__errs || []);
const errors = [...ctx.errors, ...swErrs];
check("no extension errors (page, SW)", errors.length === 0, errors);
save("G-pages-results.json");
await context.close();
