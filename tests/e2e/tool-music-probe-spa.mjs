import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, consent, sleep, until, OUT as BASE } from "./harness.mjs";

const OUT = join(BASE, "..", "music-probe");
mkdirSync(OUT, { recursive: true });
const ctx = await launch({ name: "music-probe-spa", extension: false });
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
const results = {};
const save = () => writeFileSync(join(OUT, "spa-results.json"), JSON.stringify(results, null, 2));

const dom = () =>
  page.evaluate(() => {
    const flexy = document.querySelector("ytd-watch-flexy");
    const panel = document.querySelector("ytd-watch-flexy ytd-playlist-panel-renderer#playlist");
    const d = panel?.data || null;
    return {
      url: location.search.replace(/&pp=[^&]*/, ""),
      flexyVideo: flexy?.getAttribute("video-id") ?? null,
      flexyPlaylist: flexy?.hasAttribute("playlist") ?? null,
      panelHidden: panel ? panel.hasAttribute("hidden") : null,
      panelType: panel?.getAttribute("playlist-type") ?? null,
      panelItems: panel?.querySelectorAll("ytd-playlist-panel-video-renderer").length ?? 0,
      selected: panel?.querySelector("ytd-playlist-panel-video-renderer[selected] a#wc-endpoint")?.getAttribute("href")?.replace(/&pp=[^&]*/, "") ?? null,
      dataId: d?.playlistId ?? null,
      dataInfinite: d?.isInfinite ?? null,
      initDataList: window.ytInitialData?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.playlistId ?? null,
    };
  });

const installObserver = () =>
  page.evaluate(() => {
    window.__log = [];
    const t0 = performance.now();
    const snap = (name) => {
      const flexy = document.querySelector("ytd-watch-flexy");
      const panel = document.querySelector("ytd-watch-flexy ytd-playlist-panel-renderer#playlist");
      window.__log.push({ name, t: Math.round(performance.now() - t0), url: location.search.slice(0, 50), flexyVideo: flexy?.getAttribute("video-id"), flexyPlaylist: flexy?.hasAttribute("playlist"), panelHidden: panel?.hasAttribute("hidden"), panelType: panel?.getAttribute("playlist-type") });
    };
    for (const ev of ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated"]) document.addEventListener(ev, () => snap(ev));
    const flexy = document.querySelector("ytd-watch-flexy");
    if (flexy) new MutationObserver(() => snap("flexy-attr")).observe(flexy, { attributes: true, attributeFilter: ["playlist", "video-id"] });
  });

const goto = async (key, url, ms = 9000) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await consent(page);
  const r = await until(dom, (d) => d.flexyVideo && (d.flexyPlaylist || d.panelItems === 0), ms, 500);
  await sleep(2000);
  results[key] = await dom();
  console.log(key, JSON.stringify(results[key]));
  save();
};

const MUSIC = ["5NV6Rdv1a3I", "xKpzH5bxYsk", "b1kbLwvqugk", "xFYQQPAOz7Y", "BMuknRb7woc", "jX6kn9_U8qk"];
const NON = ["fWjsdhR3z3c", "ZAzWPE9CItg", "_c2e1NcI3Sc", "efOW5NUTYB8", "CHhwJjR0mZA"];
for (const v of MUSIC) await goto(`rd-music-${v}`, `https://www.youtube.com/watch?v=${v}&list=RD${v}&start_radio=1`);
for (const v of NON) await goto(`rd-non-${v}`, `https://www.youtube.com/watch?v=${v}&list=RD${v}&start_radio=1`);
await goto("rdmm", `https://www.youtube.com/watch?v=${MUSIC[0]}&list=RDMM`);
await goto("rdclak", `https://www.youtube.com/watch?v=${MUSIC[0]}&list=RDCLAK5uy_nZJzoZEBYRptA2XXskbxGTvKkevapT_F4`);
await goto("rdcm-channel-mix-nonmusic", `https://www.youtube.com/watch?v=efOW5NUTYB8&list=RDCMUCsXVk37bltHxD1rDPwtNM8Q`);
await goto("wl", `https://www.youtube.com/watch?v=${MUSIC[0]}&list=WL`);
await goto("ll", `https://www.youtube.com/watch?v=${MUSIC[0]}&list=LL`);
await goto("single-music", `https://www.youtube.com/watch?v=${MUSIC[0]}`);

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("python tutorial playlist")}&sp=EgIQAw%253D%253D`, { waitUntil: "domcontentloaded" });
await sleep(4000);
const plHref = await page.evaluate(() => [...document.querySelectorAll('a[href*="list=PL"]')].map((a) => a.getAttribute("href")).find((h) => h.includes("/watch")));
if (plHref) await goto("pl", `https://www.youtube.com${plHref}`);
await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("random access memories album")}`, { waitUntil: "domcontentloaded" });
await sleep(4000);
results.albumHrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="list="]')].map((a) => a.getAttribute("href").replace(/&pp=[^&]*/, "")))].slice(0, 12));
console.log("albumHrefs", JSON.stringify(results.albumHrefs));
const olak = results.albumHrefs.find((h) => h.includes("OLAK5uy_") && h.includes("/watch"));
if (olak) await goto("olak", `https://www.youtube.com${olak}`);
save();

await goto("spa-mix-start", `https://www.youtube.com/watch?v=${MUSIC[0]}&list=RD${MUSIC[0]}&start_radio=1`);
await installObserver();
await page.locator("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer a#wc-endpoint").nth(2).click().catch((e) => console.log("click1", e.message));
await sleep(7000);
results.spaMixNext = await dom();
results.spaMixNextLog = await page.evaluate(() => window.__log);
console.log("spaMixNext", JSON.stringify(results.spaMixNext), JSON.stringify(results.spaMixNextLog));
save();

await page.evaluate(() => (window.__log = []));
await page.evaluate((v) => {
  const a = document.querySelector("ytd-watch-metadata a.yt-simple-endpoint[href^='/@'], #owner a[href^='/@']");
  const link = document.createElement("a");
  link.href = `/watch?v=${v}`;
  link.className = "yt-simple-endpoint style-scope ytd-compact-video-renderer";
  link.id = "probe-link";
  link.textContent = "probe";
  (document.querySelector("#below") || document.body).prepend(link);
}, NON[0]);
const spaNav = async (url) =>
  page.evaluate((u) => {
    const app = document.querySelector("ytd-app");
    const ep = { commandMetadata: { webCommandMetadata: { url: u, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } }, watchEndpoint: { videoId: new URL(u, location.origin).searchParams.get("v"), playlistId: new URL(u, location.origin).searchParams.get("list") || undefined } };
    app?.fire?.("yt-navigate", { endpoint: ep });
    return Boolean(app?.fire);
  }, url);
results.spaToSingleFired = await spaNav(`/watch?v=${NON[0]}`);
await sleep(8000);
results.spaToSingle = await dom();
results.spaToSingleLog = await page.evaluate(() => window.__log);
console.log("spaToSingle", results.spaToSingleFired, JSON.stringify(results.spaToSingle), JSON.stringify(results.spaToSingleLog));
save();

await page.evaluate(() => (window.__log = []));
results.spaToMixFired = await spaNav(`/watch?v=${MUSIC[2]}&list=RD${MUSIC[2]}&start_radio=1`);
await sleep(8000);
results.spaToMix = await dom();
results.spaToMixLog = await page.evaluate(() => window.__log);
console.log("spaToMix", results.spaToMixFired, JSON.stringify(results.spaToMix), JSON.stringify(results.spaToMixLog));
save();

await page.evaluate(() => (window.__log = []));
results.spaToNonMixFired = await spaNav(`/watch?v=${NON[1]}&list=RD${NON[1]}&start_radio=1`);
await sleep(8000);
results.spaToNonMix = await dom();
results.spaToNonMixLog = await page.evaluate(() => window.__log);
console.log("spaToNonMix", JSON.stringify(results.spaToNonMix), JSON.stringify(results.spaToNonMixLog));
save();

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("eminem lose yourself")}`, { waitUntil: "domcontentloaded" });
await sleep(4000);
await page.evaluate(() => (window.__log = []));
await installObserver().catch(() => {});
await page.locator("ytd-video-renderer a#video-title").first().click().catch((e) => console.log("click search", e.message));
await sleep(9000);
results.searchClickMusic = await dom();
results.searchClickMusicLog = await page.evaluate(() => window.__log);
console.log("searchClickMusic", JSON.stringify(results.searchClickMusic), JSON.stringify(results.searchClickMusicLog));
save();

await ctx.context.close();
