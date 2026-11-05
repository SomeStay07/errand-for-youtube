import { launch, consent, sleep } from "/Users/timurceberda/Developer/errand-for-youtube/tests/e2e/harness.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ARM = process.env.ARM || "ext";
const PRESET = process.env.PRESET || "";
const ROUNDS = Number(process.env.ROUNDS || 1);
const OUTDIR = join(process.env.OUT, `${ARM}${PRESET ? `-${PRESET}` : ""}${process.env.WIDTH ? `-w${process.env.WIDTH}` : ""}`);
mkdirSync(OUTDIR, { recursive: true });
const PORT = Number(process.env.PORT || 9491);
const WATCH = process.env.WATCH_URL || "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const PROBE = () => {
  if (window.top !== window) return;
  const T0 = performance.now();
  const log = (window.__flash = { samples: [], attrs: [], css: null, t0: T0, origin: performance.timeOrigin });
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0 && el.checkVisibility({ visibilityProperty: true }) ? Math.round(r.height) : 0;
  };
  const count = (sel) => {
    let n = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > 0 && r.top < innerHeight && el.checkVisibility()) n += 1;
    }
    return n;
  };
  const checkCss = () => {
    if (log.css !== null) return;
    const p = document.createElement("ytd-reel-shelf-renderer");
    (document.documentElement || document).appendChild(p);
    if (getComputedStyle(p).display === "none") log.css = performance.now();
    else log.cssMiss = (log.cssMiss || 0) + 1;
    p.remove();
  };
  const start = () => {
  checkCss();
  new MutationObserver((list) => {
    for (const m of list) {
      const name = m.attributeName;
      if (name && name.startsWith("data-er-")) log.attrs.push([performance.now(), name, document.documentElement.getAttribute(name)]);
    }
  }).observe(document.documentElement, { attributes: true });
  for (const a of document.documentElement.attributes) if (a.name.startsWith("data-er-")) log.attrs.push([performance.now(), a.name, a.value, "pre"]);
  let lastKey = "";
  const tick = () => {
    checkCss();
    const s = {
      skelHome: vis("#home-container-skeleton"),
      skelGuide: vis("#guide-skeleton"),
      skelWatchRelated: vis("#watch-page-skeleton #related"),
      skelWatch: vis("#watch-page-skeleton"),
      browseHome: vis('ytd-browse[page-subtype="home"]'),
      chips: vis('ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer'),
      richItems: count("ytd-rich-item-renderer"),
      shorts: count('a[href^="/shorts/"]'),
      related: vis("ytd-watch-flexy #related"),
      relatedItems: count("ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-flexy #related ytd-compact-video-renderer"),
      search: count("ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model"),
      intent: vis("#er-intent"),
      guideShorts: count('ytd-guide-entry-renderer a[title="Shorts"], ytd-mini-guide-entry-renderer[aria-label="Shorts"]'),
      app: vis("ytd-app"),
      path: location.pathname,
    };
    const key = JSON.stringify(s);
    if (key !== lastKey) {
      log.samples.push([performance.now(), s]);
      lastKey = key;
    }
    if (performance.now() - T0 < 120000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  };
  if (document.documentElement) start();
  else {
    const mo = new MutationObserver(() => {
      if (!document.documentElement) return;
      mo.disconnect();
      log.lateHtml = performance.now();
      start();
    });
    mo.observe(document, { childList: true });
  }
};

const WIDTH = Number(process.env.WIDTH || 1280);
const HEIGHT = Number(process.env.HEIGHT || 800);
const ONLY = (process.env.ONLY || "home-cold,home-warm,results,watch,spa").split(",");
const ctx = await launch({ name: `flash-${ARM}${PRESET}`, port: PORT, extension: ARM === "ext", width: WIDTH, height: HEIGHT });
const { context } = ctx;
await sleep(1500);
if (ARM === "ext" && PRESET) {
  await ctx.worker.evaluate(async (preset) => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const p = {
      subs: { homeTarget: "subs" },
      feed: { homeTarget: "feed" },
      strict: { mode: "strict" },
    }[preset];
    await chrome.storage.local.set({ settings: { ...settings, ...p } });
  }, PRESET);
}
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
let page = context.pages()[0] || (await context.newPage());
await page.goto("https://www.youtube.com/results?search_query=a", { waitUntil: "domcontentloaded" });
await consent(page);
await page.close();
page = await context.newPage();
await page.addInitScript(PROBE);
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Page.enable");

let frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
  cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

async function record(name, action, { waitMs = 8000 } = {}) {
  frames = [];
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: 640, maxHeight: 400, everyNthFrame: 1 });
  await sleep(300);
  const tStart = Date.now();
  await action();
  await sleep(waitMs);
  await cdp.send("Page.stopScreencast");
  await sleep(200);
  const flash = await page.evaluate(() => {
    const f = window.__flash;
    if (!f) return null;
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, e.startTime]));
    const nav = performance.getEntriesByType("navigation")[0];
    return { ...f, paints, dcl: nav?.domContentLoadedEventStart, resp: nav?.responseStart, respEnd: nav?.responseEnd };
  });
  const dir = join(OUTDIR, name);
  mkdirSync(dir, { recursive: true });
  const base = flash && name.startsWith("spa") === false ? flash.origin : tStart;
  const samples = flash?.samples || [];
  const stateAt = (abs) => {
    let cur = null;
    for (const [t, s] of samples) if (flash.origin + t <= abs) cur = s;
    return cur;
  };
  const rows = [];
  frames.forEach((f, i) => {
    const rel = Math.round(f.ts - base);
    const file = `${String(i).padStart(3, "0")}_${rel}ms.jpg`;
    writeFileSync(join(dir, file), Buffer.from(f.data, "base64"));
    rows.push({ i, rel, file, state: stateAt(f.ts) });
  });
  const rel = (t) => (t == null ? null : Math.round(flash.origin + t - base));
  const firstSample = (pred) => {
    const hit = samples.find(([, s]) => pred(s));
    return hit ? rel(hit[0]) : null;
  };
  const attr = (n) => {
    const hit = flash?.attrs.find((a) => a[1] === n);
    return hit ? rel(hit[0]) : null;
  };
  const summary = {
    name,
    base: base === tStart ? "action" : "navigationStart",
    frames: frames.length,
    fp: rel(flash?.paints?.["first-paint"]),
    fcp: rel(flash?.paints?.["first-contentful-paint"]),
    responseStart: rel(flash?.resp),
    dcl: rel(flash?.dcl),
    cssActive: rel(flash?.css),
    erPage: attr("data-er-page") ?? (flash?.attrs.some((a) => a[1] === "data-er-page" && a[3] === "pre") ? "pre-init" : null),
    erApply: attr("data-er-no-autoplay") ?? attr("data-er-playlist"),
    intentVisible: firstSample((s) => s.intent > 0),
    skelHomeVisible: firstSample((s) => s.skelHome > 0),
    skelHomeGone: (() => {
      const on = samples.findIndex(([, s]) => s.skelHome > 0);
      if (on < 0) return null;
      const off = samples.slice(on).find(([, s]) => s.skelHome === 0);
      return off ? rel(off[0]) : null;
    })(),
    skelWatchRelatedVisible: firstSample((s) => s.skelWatchRelated > 0),
    skelWatchRelatedGone: (() => {
      const on = samples.findIndex(([, s]) => s.skelWatchRelated > 0);
      if (on < 0) return null;
      const off = samples.slice(on).find(([, s]) => s.skelWatchRelated === 0);
      return off ? rel(off[0]) : null;
    })(),
    browseHomeVisible: firstSample((s) => s.browseHome > 0),
    richItemsVisible: firstSample((s) => s.richItems > 0),
    shortsVisible: firstSample((s) => s.shorts > 0),
    relatedVisible: firstSample((s) => s.related > 0),
    relatedItemsVisible: firstSample((s) => s.relatedItems > 0),
    searchVisible: firstSample((s) => s.search > 0),
    guideShortsVisible: firstSample((s) => s.guideShorts > 0),
    attrs: flash?.attrs?.map((a) => [rel(a[0]), a[1], a[2], a[3]].filter((x) => x !== undefined)),
  };
  const firstFrame = rows.find((r) => r.rel >= 0);
  summary.firstFrame = firstFrame ? firstFrame.rel : null;
  summary.flashFrames = rows
    .filter((r) => r.state && (r.state.skelHome || r.state.skelWatchRelated || r.state.richItems || r.state.shorts || r.state.relatedItems || r.state.guideShorts))
    .map((r) => `${r.file}:${["skelHome", "skelWatchRelated", "richItems", "shorts", "relatedItems", "guideShorts"].filter((k) => r.state[k]).join("+")}`);
  writeFileSync(join(dir, "frames.json"), JSON.stringify({ summary, rows, samples: samples.map(([t, s]) => [rel(t), s]) }, null, 2));
  console.log(JSON.stringify({ ...summary, attrs: undefined, flashFrames: summary.flashFrames.slice(0, 12), flashFrameCount: summary.flashFrames.length }));
  return summary;
}

const results = [];
for (let r = 0; r < ROUNDS; r++) {
  const sfx = ROUNDS > 1 ? `-r${r}` : "";
  await cdp.send("Network.clearBrowserCache");
  await page.goto("about:blank");
  if (ONLY.includes("home-cold")) results.push(await record(`home-cold${sfx}`, () => page.goto("https://www.youtube.com/", { waitUntil: "commit" })));
  await page.goto("about:blank");
  if (ONLY.includes("home-warm")) results.push(await record(`home-warm${sfx}`, () => page.goto("https://www.youtube.com/", { waitUntil: "commit" })));
  await page.goto("about:blank");
  if (ONLY.includes("results")) results.push(await record(`results${sfx}`, () => page.goto("https://www.youtube.com/results?search_query=swiftui+navigation+stack+tutorial", { waitUntil: "commit" })));
  await page.goto("about:blank");
  if (ONLY.includes("watch")) results.push(await record(`watch${sfx}`, () => page.goto(WATCH, { waitUntil: "commit" })));
}

if (ONLY.includes("spa") && (!PRESET || PRESET === "feed")) {
  await page.goto("https://www.youtube.com/results?search_query=swiftui+navigation+stack+tutorial", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("ytd-search a#thumbnail[href^='/watch']", { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  results.push(
    await record("spa-results-to-watch", async () => {
      await page.locator("ytd-search a#thumbnail[href^='/watch']").first().click({ timeout: 5000 }).catch((e) => console.log("click fail", e.message));
    }),
  );
  results.push(
    await record("spa-watch-to-home", async () => {
      await page.locator("ytd-topbar-logo-renderer a#logo, a#logo").first().click({ timeout: 5000 }).catch((e) => console.log("logo fail", e.message));
    }),
  );
  results.push(
    await record("spa-home-to-results", async () => {
      const box = page.locator("input[name='search_query']").first();
      await box.click({ timeout: 5000 }).catch(() => {});
      await box.fill("swift concurrency", { timeout: 5000 }).catch(() => {});
      await box.press("Enter").catch(() => {});
    }),
  );
}
writeFileSync(join(OUTDIR, "summary.json"), JSON.stringify(results, null, 2));
await context.close();
