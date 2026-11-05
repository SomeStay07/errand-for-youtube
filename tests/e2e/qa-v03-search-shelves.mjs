import { join } from "node:path";
import { launch, reporter, consent, sleep, prefCookie, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-v03-search-shelves", port: 9373 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
const W = ctx.worker;
const SHELF = await W.evaluate(() => globalThis.ErrandLib.SEARCH_SHELF);
const settings = () => W.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => globalThis.ErrandLib.mergeSettings(settings)));
const setSettings = (patch) => W.evaluate((p) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.mergeSettings(settings), ...p } })), patch);
const setRelated = async (on) => setSettings({ hide: { ...(await settings()).hide, related: on } });
const recheck = async () => {
  const { endPrompt } = await settings();
  await setSettings({ endPrompt: !endPrompt });
  await sleep(200);
  await setSettings({ endPrompt });
};
const health = async () => {
  const { health: h = {} } = await W.evaluate(() => chrome.storage.session.get("health"));
  const [id, entry] = Object.entries(h).sort((a, b) => b[1].ts - a[1].ts)[0] || [];
  return { entry, badge: id ? await W.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), Number(id)) : null };
};
const scan = () =>
  page.evaluate((shelf) => {
    const vis = (n) => n.getBoundingClientRect().height > 0;
    const count = (sel) => [...document.querySelectorAll(sel)].filter(vis).length;
    const strips = "ytd-expandable-metadata-renderer ytd-horizontal-card-list-renderer";
    const root = document.documentElement;
    const withRule = { shelves: count(shelf), strips: count(strips) };
    const had = root.hasAttribute("data-er-show-related");
    root.setAttribute("data-er-show-related", "");
    const without = { shelves: count(shelf), strips: count(strips) };
    if (!had) root.removeAttribute("data-er-show-related");
    return {
      url: location.pathname + location.search,
      shelvesTotal: document.querySelectorAll(shelf).length,
      shelves: withRule.shelves,
      shelvesWithoutRule: without.shelves,
      strips: withRule.strips,
      stripsWithoutRule: without.strips,
      videos: count("ytd-search ytd-video-renderer"),
      channel: count("ytd-search ytd-channel-renderer"),
      didYouMean: count("ytd-search :is(yt-did-you-mean-renderer, ytd-did-you-mean-renderer, ytd-showing-results-for-renderer)"),
      playlists: [...document.querySelectorAll("ytd-search yt-lockup-view-model")].filter((n) => vis(n) && n.querySelector('a[href*="list="]')).length,
    };
  }, SHELF);
const search = async (q) => {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector("ytd-search ytd-item-section-renderer", { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 4000);
    await sleep(1500);
  }
  return scan();
};

const QUERIES = [
  ["lofi", "en", (s) => true],
  ["minecraft", "en", (s) => true],
  ["mkbhd", "en", (s) => s.channel > 0],
  ["how to tye a tie", "en", (s) => s.didYouMean > 0],
  ["python tutorial", "en", (s) => s.playlists > 0],
  ["how to tie a tie", "de", (s) => true],
];
let seenShelves = 0;
for (const [q, hl, extra] of QUERIES) {
  await context.clearCookies();
  if (hl !== "en") await prefCookie(context, hl);
  const s = await search(q);
  seenShelves += s.shelvesTotal;
  await page.screenshot({ path: join(OUT, `SS-${hl}-${q.replace(/\W+/g, "-")}.png`) });
  check(`F4 "${q}" (hl=${hl}): 0 visible shelves, > 5 videos, chapter strips unchanged${q === "mkbhd" ? ", channel card" : q === "how to tye a tie" ? ", did-you-mean" : q === "python tutorial" ? ", playlist lockups" : ""}`, s.shelves === 0 && s.videos > 5 && s.strips === s.stripsWithoutRule && extra(s), s);
}
await context.clearCookies();
check("F4 at least one shelf was present to hide across the queries", seenShelves > 0 ? true : null, { seenShelves });
await sleep(2000);
const clean = await health();
check("F4 clean searches with scroll: no '!'", clean.badge !== "!" && clean.entry?.missing.length === 0, clean);

let shelfQuery = null;
for (const q of ["lofi", "minecraft"]) {
  const s = await search(q);
  if (s.shelvesTotal > 0) {
    shelfQuery = q;
    break;
  }
}
if (shelfQuery) {
  await setRelated(false);
  await sleep(800);
  const off = await scan();
  await setRelated(true);
  await sleep(800);
  const on = await scan();
  check(`F4 "${shelfQuery}" open tab: untick Recommendations → shelf visible, tick → hidden, no reload`, off.shelves > 0 && on.shelves === 0, { off: off.shelves, on: on.shelves });
  await W.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 60_000 }));
  await sleep(1000);
  const paused = await scan();
  await W.evaluate(() => chrome.storage.local.remove("pausedUntil"));
  await sleep(800);
  check(`F4 "${shelfQuery}" paused → shelf visible`, paused.shelves > 0, paused.shelves);
  await setSettings(await W.evaluate(() => globalThis.ErrandLib.applyPreset({}, "shorts")));
  await sleep(800);
  const preset = await scan();
  await setSettings(await W.evaluate(() => globalThis.ErrandLib.applyPreset({}, "ask")));
  await sleep(800);
  check(`F4 "${shelfQuery}" preset 'Just hide Shorts' → shelf visible`, preset.shelves > 0, preset.shelves);
} else check("F4 shelf visible with Recommendations off / paused / 'Just hide Shorts'", null, "no shelf on lofi or minecraft today");

async function injected(where, related = true) {
  await search("swiftui navigation stack tutorial");
  await setRelated(related);
  await page.evaluate((w) => {
    const section = document.querySelector("ytd-search ytd-item-section-renderer");
    const shelf = document.createElement("ytd-shelf-renderer");
    shelf.id = "qa-shelf";
    shelf.style.cssText = "display:block;height:200px;background:#c00";
    if (w === "inside") section.querySelector(":scope > #contents").prepend(shelf);
    else {
      const wrap = document.createElement("div");
      wrap.className = "qa-wrap";
      wrap.append(shelf);
      section.prepend(wrap);
    }
  }, where);
  await recheck();
  const at = Date.now();
  let h = await health();
  while (Date.now() - at < 15000 && !(where === "outside" && related && h.badge === "!" && h.entry?.missing.includes("related"))) {
    await sleep(500);
    h = await health();
  }
  const height = await page.evaluate(() => Math.round(document.getElementById("qa-shelf")?.getBoundingClientRect().height ?? -1));
  await page.evaluate(() => document.getElementById("qa-shelf")?.closest(".qa-wrap, #qa-shelf")?.remove());
  await setRelated(true);
  return { height, ms: Date.now() - at, badge: h.badge, missing: h.entry?.missing };
}
const outside = await injected("outside");
check("F4 LEAKS.search: shelf outside #contents → '!' naming related", outside.badge === "!" && outside.missing?.includes("related"), outside);
const inside = await injected("inside");
check("F4 LEAKS.search: shelf inside #contents is hidden → no '!'", inside.height === 0 && inside.badge !== "!", inside);
const off = await injected("outside", false);
check("F4 LEAKS.search: Recommendations off + visible shelf → no '!'", off.height > 0 && off.badge !== "!", off);

const errs = [...ctx.errors, ...(await W.evaluate(() => globalThis.__errs || []))];
check("no extension errors", errs.length === 0, errs);
save("SS-search-shelves.json");
await context.close();
