import { join } from "node:path";
import { launch, reporter, consent, sleep, until, closeWelcome, finish, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "v03-mix-list" });
await closeWelcome(ctx);
const page = ctx.context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await ctx.context.newPage());

const state = () =>
  page.evaluate(() => {
    const watch = document.querySelector("ytd-watch-flexy, ytd-watch-grid");
    const panel = document.querySelector("ytd-playlist-panel-renderer#playlist");
    return {
      url: location.pathname + location.search.replace(/&pp=[^&]*/, ""),
      erPage: document.documentElement.dataset.erPage,
      erPlaylist: document.documentElement.hasAttribute("data-er-playlist"),
      erAutoplayOff: document.documentElement.hasAttribute("data-er-autoplay-off"),
      watchPlaylist: watch?.hasAttribute("playlist") ?? null,
      watchVideo: watch?.getAttribute("video-id") ?? null,
      panelItems: panel && !panel.hasAttribute("hidden") ? panel.querySelectorAll("ytd-playlist-panel-video-renderer").length : 0,
      autonav: document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked") ?? null,
      playerUnavailable: Boolean(watch?.hasAttribute("player-unavailable")),
    };
  });

const settle = async (pred, ms = 15000) => (await until(state, pred, ms, 500)).value;
const shot = (name) => page.screenshot({ path: join(OUT, `mix-list-${name}.png`) }).catch(() => {});

const searchHrefs = async (q, extra = "") => {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${extra}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector('a[href^="/watch"]', { state: "attached", timeout: 20000 }).catch(() => {});
  await sleep(3000);
  return page.evaluate(() => [...document.querySelectorAll("ytd-video-renderer a#thumbnail[href^='/watch']")].map((a) => a.getAttribute("href")));
};
const vidOf = (href) => (href ? new URLSearchParams(href.split("?")[1]).get("v") : null);

const MUSIC_Q = "eminem lose yourself";
const musicHrefs = await searchHrefs(MUSIC_Q);
const canary = await page.evaluate(() => {
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden";
  const seededVideos = [...document.querySelectorAll("ytd-video-renderer")].filter((n) => n.querySelector('a[href*="start_radio=1"]'));
  const singleLockups = [...document.querySelectorAll("ytd-search yt-lockup-view-model")].filter((n) => n.querySelector('a[href*="start_radio=1"]') && !n.querySelector("yt-collection-thumbnail-view-model, yt-collections-stack"));
  return {
    videosVisible: [...document.querySelectorAll("ytd-video-renderer, ytd-search yt-lockup-view-model")].filter(vis).length,
    seededVideos: seededVideos.length,
    seededVideosHidden: seededVideos.filter((n) => !vis(n)).length,
    singleSeededLockups: singleLockups.length,
    singleSeededLockupsHidden: singleLockups.filter((n) => !vis(n)).length,
    mixTilesVisible: [...document.querySelectorAll('ytd-radio-renderer, ytd-search yt-lockup-view-model:has(yt-collection-thumbnail-view-model):has(a[href*="start_radio=1"])')].filter(vis).length,
  };
});
await shot("search-music");
check("search (music query): at least one video result visible", canary.videosVisible >= 1, canary);
if (canary.seededVideos + canary.singleSeededLockups === 0) check("search (music query): precondition, YouTube seeded no result with start_radio=1", null, canary);
else check("search (music query): no single-song result hidden for linking to start_radio=1 (hide.css:81 canary)", canary.seededVideosHidden === 0 && canary.singleSeededLockupsHidden === 0, canary);
check("search (music query): no Mix tile visible", canary.mixTilesVisible === 0, canary);

const seeded = musicHrefs.find((h) => h.includes("start_radio=1"));
const music = vidOf(seeded) || vidOf(musicHrefs[0]);
const nonHrefs = await searchHrefs("python tutorial");
const non = vidOf(nonHrefs[0]);
check("search (non-music query): first result is not a seeded Mix", Boolean(nonHrefs[0]) && !/list=RD|start_radio/.test(nonHrefs[0]), nonHrefs[0] || "no result");

const single = async (key) => {
  const s = await settle((x) => x.watchVideo === non && x.erPage === "watch");
  await sleep(3000);
  return { key, ...(await state()) };
};

await page.goto(`https://www.youtube.com/watch?v=${non}`, { waitUntil: "domcontentloaded" });
const control = await single("control");
const autoplayObservable = control.erAutoplayOff;
if (!autoplayObservable) check("precondition: Errand can turn autonav off on a single video in this browser", null, control);

await page.goto(`https://www.youtube.com/watch?v=${music}&list=RD${music}&start_radio=1`, { waitUntil: "domcontentloaded" });
await consent(page);
const mixHard = await settle((x) => x.panelItems > 0 && x.erPlaylist, 15000);
await sleep(3000);
const mixHardLate = await state();
await shot("mix-hard");
check("music Mix (hard load): YouTube shows the Mix panel", mixHardLate.panelItems > 0 && mixHardLate.watchPlaylist === true, mixHardLate);
check("music Mix (hard load): html[data-er-playlist] present", mixHardLate.erPlaylist, { first: mixHard, late: mixHardLate });
if (autoplayObservable) check("music Mix (hard load): Errand did not force autonav off (no data-er-autoplay-off)", !mixHardLate.erAutoplayOff, mixHardLate);
else check("music Mix (hard load): Errand did not force autonav off (no data-er-autoplay-off)", null, "autonav toggle not actionable headless (see precondition)");

await page.goto(`https://www.youtube.com/watch?v=${non}&list=RD${non}&start_radio=1`, { waitUntil: "domcontentloaded" });
const nonMix = await single("nonMix");
await shot("nonmusic-rd");
check("non-music RD<id>: no panel, html[data-er-playlist] absent", nonMix.panelItems === 0 && nonMix.watchPlaylist === false && !nonMix.erPlaylist, nonMix);

const plHrefs = await page
  .goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("python tutorial playlist")}&sp=EgIQAw%253D%253D`, { waitUntil: "domcontentloaded" })
  .then(() => sleep(5000))
  .then(() => page.evaluate(() => [...document.querySelectorAll('a[href*="list=PL"]')].map((a) => a.getAttribute("href")).filter((h) => h.includes("/watch"))));
if (!plHrefs.length) check("PL playlist: precondition, no PL watch link found in search", null);
else {
  await page.goto(`https://www.youtube.com${plHrefs[0]}`, { waitUntil: "domcontentloaded" });
  const pl = await settle((x) => x.panelItems > 0 && x.erPlaylist, 15000);
  await shot("pl");
  check("PL playlist: panel shown and html[data-er-playlist] present", pl.panelItems > 0 && pl.watchPlaylist === true && pl.erPlaylist, pl);
}

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(MUSIC_Q)}`, { waitUntil: "domcontentloaded" });
await sleep(4000);
const link = page.locator("ytd-video-renderer a#video-title").first();
const clickedHref = await link.getAttribute("href").catch(() => null);
await link.click().catch(() => {});
const spaIn = await settle((x) => x.erPage === "watch" && x.watchVideo === vidOf(clickedHref) && (x.panelItems > 0 ? x.erPlaylist : true), 15000);
await sleep(2000);
const spaInLate = await state();
await shot("spa-search-click");
if (!clickedHref?.includes("list=")) check("SPA search click on a song: precondition, YouTube did not seed a Mix for this result", null, clickedHref);
else {
  check("SPA search → Mix: html[data-er-playlist] present", spaInLate.panelItems > 0 && spaInLate.erPlaylist, { href: clickedHref, at: spaIn, late: spaInLate });
  if (autoplayObservable) check("SPA search → Mix: no data-er-autoplay-off", !spaInLate.erAutoplayOff, spaInLate);
}

if (spaInLate.panelItems > 2) {
  const itemHref = await page.evaluate(() => {
    const a = document.querySelectorAll("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer a#wc-endpoint")[2];
    a?.click();
    return a?.getAttribute("href") ?? null;
  });
  const next = await settle((x) => x.watchVideo === vidOf(itemHref), 15000);
  await sleep(1500);
  const nextLate = await state();
  check("SPA inside the Mix (3rd item, no start_radio in URL): html[data-er-playlist] still present", nextLate.erPlaylist && !/start_radio/.test(nextLate.url), { at: next, late: nextLate });
}

await page.evaluate((v) => {
  document.querySelector("ytd-app").fire("yt-navigate", { endpoint: { commandMetadata: { webCommandMetadata: { url: `/watch?v=${v}`, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } }, watchEndpoint: { videoId: v } } });
}, non);
const out = await settle((x) => x.watchVideo === non && !x.erPlaylist, 15000);
await sleep(2000);
const outLate = await state();
await shot("spa-out");
check("SPA hop Mix → plain /watch: html[data-er-playlist] cleared", outLate.url === `/watch?v=${non}` && !outLate.erPlaylist && outLate.watchPlaylist === false, { at: out, late: outLate });
if (autoplayObservable) check("SPA hop Mix → plain /watch: autonav off on the single video", outLate.autonav === "false", { late: outLate });

check("playback: Mix plays 3 tracks in a row with no end prompt (manual, Timur's Chrome)", null, "YouTube bot check blocks playback headless");
check("playback: single video ends → no next video, end prompt shows (manual)", null, "YouTube bot check blocks playback headless");

await finish(ctx, check, { name: "no extension errors (page, SW)" });
save("v03-mix-list.json");
await ctx.context.close();
