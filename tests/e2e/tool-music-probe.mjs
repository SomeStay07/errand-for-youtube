import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, consent, sleep, OUT as BASE } from "./harness.mjs";

const OUT = join(BASE, "..", "music-probe");
mkdirSync(OUT, { recursive: true });
const ctx = await launch({ name: "music-probe", extension: false });
const page = ctx.context.pages()[0] || (await ctx.context.newPage());

const read = () =>
  page.evaluate(() => {
    const flexy = document.querySelector("ytd-watch-flexy");
    const panel = document.querySelector("ytd-watch-flexy ytd-playlist-panel-renderer#playlist");
    const mp = document.getElementById("movie_player");
    const init = window.ytInitialPlayerResponse;
    let live = null;
    try {
      live = mp?.getPlayerResponse?.() || null;
    } catch {}
    const pr = (r) =>
      r && {
        id: r.videoDetails?.videoId,
        musicVideoType: r.videoDetails?.musicVideoType ?? null,
        category: r.microformat?.playerMicroformatRenderer?.category ?? null,
        isCrawlable: r.videoDetails?.isCrawlable,
      };
    const wd = window.ytInitialData?.contents?.twoColumnWatchNextResults;
    const pl = wd?.playlist?.playlist;
    const pdata = panel?.data || panel?.__data?.data || null;
    let vd = null;
    let gp = null;
    try {
      vd = mp?.getVideoData?.();
      gp = mp?.getPlaylist?.();
    } catch {}
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent.slice(0, 400));
    const attrSection = [...document.querySelectorAll("ytd-watch-metadata yt-video-attributes-section-view-model, ytd-watch-metadata ytd-video-description-music-section-renderer, ytd-video-description-music-section-renderer, ytd-horizontal-card-list-renderer")].map((n) => n.tagName.toLowerCase());
    const flexyData = flexy?.playerData || flexy?.__data?.playerData || null;
    return {
      url: location.pathname + location.search,
      dom: {
        metaGenre: document.querySelector('meta[itemprop="genre"]')?.content ?? null,
        metaGenreCount: document.querySelectorAll('meta[itemprop="genre"]').length,
        metaGenreInFlexy: Boolean(flexy?.querySelector('meta[itemprop="genre"]')),
        metaVideoId: document.querySelector('meta[itemprop="identifier"], meta[itemprop="videoId"]')?.content ?? null,
        flexyVideoId: flexy?.getAttribute("video-id") ?? null,
        flexyPlaylistAttr: flexy?.hasAttribute("playlist") ?? null,
        flexyAttrs: flexy ? [...flexy.attributes].map((a) => a.name).filter((n) => !/^(class|style|role)$/.test(n)) : null,
        panelPresent: Boolean(panel),
        panelHidden: panel ? panel.hasAttribute("hidden") || !panel.getClientRects().length : null,
        panelAttrs: panel ? [...panel.attributes].map((a) => `${a.name}=${a.value}`.slice(0, 60)) : null,
        panelTitle: panel?.querySelector("#header-description h3, .title, yt-formatted-string.title")?.textContent?.trim()?.slice(0, 60) ?? null,
        panelItems: panel?.querySelectorAll("ytd-playlist-panel-video-renderer").length ?? null,
        panelPublisher: panel?.querySelector("#publisher-container, .publisher")?.textContent?.trim()?.slice(0, 60) ?? null,
        musicSections: attrSection,
        ldJson: ld,
        autonavPresent: Boolean(document.querySelector('button[data-tooltip-target-id="ytp-autonav-toggle-button"]')),
        autonavVisible: Boolean(document.querySelector('button[data-tooltip-target-id="ytp-autonav-toggle-button"]')?.getClientRects().length),
        autonavChecked: document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked") ?? null,
        nextButtonVisible: Boolean(document.querySelector(".ytp-next-button")?.getClientRects().length),
        playerClasses: mp ? [...mp.classList].filter((c) => /playlist|autonav|music|radio/i.test(c)) : null,
      },
      main: {
        initial: pr(init),
        live: pr(live),
        initialDataPlaylist: pl ? { playlistId: pl.playlistId, isInfinite: pl.isInfinite ?? null, title: pl.title, keys: Object.keys(pl).slice(0, 40) } : null,
        panelData: pdata ? { playlistId: pdata.playlistId, isInfinite: pdata.isInfinite ?? null, title: pdata.title } : null,
        flexyPlayerData: flexyData ? pr(flexyData) : null,
        videoData: vd ? { id: vd.video_id, title: vd.title?.slice(0, 40), author: vd.author, list: vd.list ?? null, isListed: vd.isListed, keys: Object.keys(vd).slice(0, 30) } : null,
        getPlaylist: Array.isArray(gp) ? gp.length : gp,
        playlistId: (() => {
          try {
            return mp?.getPlaylistId?.() ?? null;
          } catch {
            return null;
          }
        })(),
      },
    };
  });

const firstHrefs = async (q, extra = "") => {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${extra}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector('a[href^="/watch"]', { state: "attached", timeout: 20000 }).catch(() => {});
  await sleep(3000);
  return page.evaluate(() =>
    [...document.querySelectorAll("ytd-video-renderer a#thumbnail, ytd-video-renderer a#video-title, yt-lockup-view-model a[href^='/watch'], ytd-radio-renderer a, ytd-playlist-renderer a, ytd-universal-watch-card-renderer a[href^='/watch']")]
      .map((a) => ({ tag: a.closest("ytd-video-renderer, yt-lockup-view-model, ytd-radio-renderer, ytd-playlist-renderer, ytd-universal-watch-card-renderer")?.tagName.toLowerCase(), href: a.getAttribute("href") }))
      .filter((x) => x.href)
      .slice(0, 40),
  );
};

const results = {};
const visit = async (key, url, wait = 7000) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await consent(page);
  await sleep(wait);
  results[key] = await read();
  await page.screenshot({ path: join(OUT, `${key}.png`) });
  console.log(key, JSON.stringify(results[key]).slice(0, 1500));
};

const searches = {
  music1: "daft punk get lucky",
  music2: "кино группа крови",
  music3: "lofi hip hop",
  nonmusic1: "python tutorial",
  nonmusic2: "how to fix a bike chain",
};
const hrefs = {};
for (const [k, q] of Object.entries(searches)) {
  hrefs[k] = await firstHrefs(q);
  console.log("search", k, JSON.stringify(hrefs[k].slice(0, 8)));
}
results.searchHrefs = hrefs;
const vidOf = (list) => list.map((x) => new URLSearchParams(x.href.split("?")[1]).get("v")).find(Boolean);

const clickFirst = async (q) => {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const link = page.locator("ytd-video-renderer a#video-title, yt-lockup-view-model a[href^='/watch']").first();
  const href = await link.getAttribute("href").catch(() => null);
  await link.click().catch(() => {});
  await sleep(6000);
  return { href, landed: page.url() };
};
results.clickMusic = await clickFirst(searches.music1);
results.clickMusicRead = await read();
console.log("clickMusic", JSON.stringify(results.clickMusic), JSON.stringify(results.clickMusicRead.main.initialDataPlaylist), JSON.stringify(results.clickMusicRead.main.live));
results.clickNonMusic = await clickFirst(searches.nonmusic1);
results.clickNonMusicRead = await read();
console.log("clickNonMusic", JSON.stringify(results.clickNonMusic));

const m = vidOf(hrefs.music1);
const m2 = vidOf(hrefs.music2);
const n = vidOf(hrefs.nonmusic1);
const n2 = vidOf(hrefs.nonmusic2);
await visit("single-music", `https://www.youtube.com/watch?v=${m}`);
await visit("single-music2", `https://www.youtube.com/watch?v=${m2}`);
await visit("single-nonmusic", `https://www.youtube.com/watch?v=${n}`);
await visit("single-nonmusic2", `https://www.youtube.com/watch?v=${n2}`);
await visit("mix-seeded-music", `https://www.youtube.com/watch?v=${m}&list=RD${m}&start_radio=1`);
await visit("mix-seeded-music2", `https://www.youtube.com/watch?v=${m2}&list=RD${m2}&start_radio=1`);
await visit("mix-seeded-nonmusic", `https://www.youtube.com/watch?v=${n}&list=RD${n}&start_radio=1`);
await visit("mix-rdmm-loggedout", `https://www.youtube.com/watch?v=${m}&list=RDMM&start_radio=1`);
await visit("wl-loggedout", `https://www.youtube.com/watch?v=${m}&list=WL`);

const plHrefs = await firstHrefs("python tutorial playlist", "&sp=EgIQAw%253D%253D");
const pl = plHrefs.map((x) => /list=(PL[\w-]+)/.exec(x.href)?.[1]).find(Boolean);
if (pl) {
  await page.goto(`https://www.youtube.com/playlist?list=${pl}`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const first = await page.evaluate(() => document.querySelector('ytd-playlist-video-renderer a#thumbnail[href*="list="]')?.getAttribute("href"));
  if (first) await visit("user-playlist-PL", `https://www.youtube.com${first}`);
}

const albumHrefs = await firstHrefs("daft punk random access memories album", "&sp=EgIQAw%253D%253D");
results.albumSearch = albumHrefs.slice(0, 15);
const olak = albumHrefs.map((x) => /list=(OLAK5uy_[\w-]+)/.exec(x.href)?.[1]).find(Boolean);
const rdclak = albumHrefs.map((x) => /list=(RDCLAK5uy_[\w-]+)/.exec(x.href)?.[1]).find(Boolean);
console.log("album ids", olak, rdclak);
if (olak) await visit("album-OLAK", `https://www.youtube.com/playlist?list=${olak}`, 4000).then(async () => {
  const first = await page.evaluate(() => document.querySelector('ytd-playlist-video-renderer a#thumbnail[href*="list="]')?.getAttribute("href"));
  if (first) await visit("album-OLAK-watch", `https://www.youtube.com${first}`);
});
const curatedHrefs = await firstHrefs("lofi beats youtube music playlist", "&sp=EgIQAw%253D%253D");
const curated = rdclak || curatedHrefs.map((x) => /list=(RDCLAK5uy_[\w-]+)/.exec(x.href)?.[1]).find(Boolean);
results.curatedSearch = curatedHrefs.slice(0, 15);
console.log("curated", curated);
if (curated) {
  await page.goto(`https://www.youtube.com/playlist?list=${curated}`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const first = await page.evaluate(() => document.querySelector('ytd-playlist-video-renderer a#thumbnail[href*="list="]')?.getAttribute("href"));
  if (first) await visit("curated-RDCLAK-watch", `https://www.youtube.com${first}`);
}

await visit("spa-start", `https://www.youtube.com/watch?v=${m}&list=RD${m}&start_radio=1`);
const spaTarget = await page.evaluate(() => {
  const items = [...document.querySelectorAll("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer a#wc-endpoint")];
  return items[3]?.getAttribute("href") || null;
});
results.spaTarget = spaTarget;
const events = [];
await page.exposeFunction("__probeEvt", (e) => events.push(e)).catch(() => {});
await page.evaluate(() => {
  const snap = (name) => {
    const mp = document.getElementById("movie_player");
    let live = null;
    try {
      live = mp?.getPlayerResponse?.();
    } catch {}
    window.__probeEvt({ name, t: Math.round(performance.now()), url: location.search.slice(0, 60), genre: document.querySelector('meta[itemprop="genre"]')?.content ?? null, liveId: live?.videoDetails?.videoId, liveType: live?.videoDetails?.musicVideoType ?? null, liveCat: live?.microformat?.playerMicroformatRenderer?.category ?? null, initId: window.ytInitialPlayerResponse?.videoDetails?.videoId });
  };
  for (const ev of ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated", "yt-player-updated"]) document.addEventListener(ev, () => snap(ev));
});
if (spaTarget) {
  await page.locator("ytd-playlist-panel-renderer#playlist ytd-playlist-panel-video-renderer a#wc-endpoint").nth(3).click().catch((e) => console.log("spa click failed", e.message));
  await sleep(7000);
  results.spaAfter = await read();
}
const spaNon = n;
await page.evaluate((v) => {
  const a = document.createElement("a");
  a.href = `/watch?v=${v}`;
  document.body.append(a);
}, spaNon);
results.events = events;
console.log("events", JSON.stringify(events));

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const played = await page.evaluate(async () => {
  const v = document.querySelector("video.html5-main-video");
  if (!v) return { video: false };
  v.muted = true;
  try {
    await v.play();
  } catch (e) {
    return { video: true, playError: String(e).slice(0, 120) };
  }
  await new Promise((r) => setTimeout(r, 3000));
  return { video: true, t: v.currentTime, paused: v.paused, dur: v.duration };
}).catch((e) => ({ error: e.message.slice(0, 120) }));
results.playback = played;
console.log("playback", JSON.stringify(played));
if (played.t > 0 && Number.isFinite(played.dur)) {
  const before = page.url();
  await page.evaluate(() => {
    const v = document.querySelector("video.html5-main-video");
    v.currentTime = v.duration - 2;
  });
  await sleep(12000);
  results.mixAdvance = { before, after: page.url(), autonav: await page.evaluate(() => document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked")) };
  console.log("mixAdvance", JSON.stringify(results.mixAdvance));
}

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
await ctx.context.close();
