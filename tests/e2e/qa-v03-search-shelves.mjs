import { join } from "node:path";
import { launch, reporter, consent, sleep, until, prefCookie, closeWelcome, healthOf, recheck as recheckOf, settingsApi, finish, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-v03-search-shelves" });
const { context } = ctx;
await closeWelcome(ctx);
const page = context.pages()[0] || (await context.newPage());
const W = ctx.worker;
const SHELF = await W.evaluate(() => globalThis.ErrandLib.SEARCH_SHELF);
const { set: setSettings, preset } = settingsApi(ctx);
const setRelated = (on) => setSettings({ hide: { related: on } });
const recheck = () => recheckOf(ctx);
const health = () => healthOf(ctx);
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
      channelAttached: document.querySelectorAll("ytd-search ytd-channel-renderer").length,
      didYouMean: count("ytd-search :is(yt-did-you-mean-renderer, ytd-did-you-mean-renderer, ytd-showing-results-for-renderer)"),
      didYouMeanAttached: document.querySelectorAll("ytd-search :is(yt-did-you-mean-renderer, ytd-did-you-mean-renderer, ytd-showing-results-for-renderer)").length,
      playlists: [...document.querySelectorAll("ytd-search yt-lockup-view-model")].filter((n) => vis(n) && n.querySelector('a[href*="list="]')).length,
      playlistsAttached: [...document.querySelectorAll("ytd-search yt-lockup-view-model")].filter((n) => n.querySelector('a[href*="list="]')).length,
    };
  }, SHELF);
const search = async (q) => {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector("ytd-search ytd-item-section-renderer", { timeout: 20000 }).catch(() => {});
  await until(scan, (s) => s.videos > 5, 10000, 500);
  await sleep(1000);
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 4000);
    await sleep(1500);
  }
  return scan();
};

const QUERIES = [
  ["lofi", "en", null],
  ["minecraft", "en", null],
  ["mkbhd", "en", ["channel card", "channel", "channelAttached"]],
  ["how to tye a tie", "en", ["did-you-mean", "didYouMean", "didYouMeanAttached"]],
  ["python tutorial", "en", ["playlist lockups", "playlists", "playlistsAttached"]],
  ["how to tie a tie", "de", null],
];
let seenShelves = 0;
for (const [q, hl, extra] of QUERIES) {
  await context.clearCookies();
  if (hl !== "en") await prefCookie(context, hl);
  const s = await search(q);
  seenShelves += s.shelvesTotal;
  await page.screenshot({ path: join(OUT, `SS-${hl}-${q.replace(/\W+/g, "-")}.png`) });
  check(`F4 "${q}" (hl=${hl}): 0 visible shelves, chapter strips unchanged`, s.videos > 5 ? s.shelves === 0 && s.strips === s.stripsWithoutRule : null, s.videos > 5 ? s : `precondition: results did not render (${JSON.stringify(s)})`);
  if (extra) {
    const [label, visibleKey, attachedKey] = extra;
    check(`F4 "${q}": ${label} not hidden by Errand`, s[attachedKey] > 0 ? s[visibleKey] > 0 : null, s[attachedKey] > 0 ? { visible: s[visibleKey], attached: s[attachedKey] } : `precondition: YouTube served no ${label} today`);
  }
}
await context.clearCookies();
check("F4 at least one shelf was present to hide across the queries", seenShelves > 0 ? true : null, seenShelves > 0 ? { seenShelves } : "precondition: no shelf served today");
const cleanAt = Date.now();
await recheck();
const { value: clean } = await until(health, (h) => h.entry?.ts > cleanAt, 20000, 500);
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
  const { value: off } = await until(scan, (x) => x.shelves > 0, 3000, 100);
  await setRelated(true);
  const { value: on } = await until(scan, (x) => x.shelves === 0, 3000, 100);
  check(`F4 "${shelfQuery}" open tab: untick Recommendations → shelf visible, tick → hidden, no reload`, off.shelves > 0 && on.shelves === 0, { off: off.shelves, on: on.shelves });
  await W.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 60_000 }));
  const { value: paused } = await until(scan, (x) => x.shelves > 0, 3000, 100);
  await W.evaluate(() => chrome.storage.local.remove("pausedUntil"));
  await until(scan, (x) => x.shelves === 0, 3000, 100);
  check(`F4 "${shelfQuery}" paused → shelf visible`, paused.shelves > 0, paused.shelves);
  await preset("shorts");
  const { value: shortsOnly } = await until(scan, (x) => x.shelves > 0, 3000, 100);
  await preset("ask");
  check(`F4 "${shelfQuery}" preset 'Just hide Shorts' → shelf visible`, shortsOnly.shelves > 0, shortsOnly.shelves);
} else check("F4 shelf visible with Recommendations off / paused / 'Just hide Shorts'", null, "precondition: no shelf on lofi or minecraft today");

async function injected(where, related = true) {
  await search("swiftui navigation stack tutorial");
  await page.waitForSelector("ytd-search ytd-item-section-renderer > #contents", { state: "attached", timeout: 20000 });
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
  const at = await recheck();
  const expectBang = where === "outside" && related;
  const { value: h } = await until(health, (x) => (expectBang ? x.badge === "!" && x.entry?.ts > at : x.entry?.ts > at), 20000, 500);
  const height = await page.evaluate(() => Math.round(document.getElementById("qa-shelf")?.getBoundingClientRect().height ?? -1));
  await page.evaluate(() => document.getElementById("qa-shelf")?.closest(".qa-wrap, #qa-shelf")?.remove());
  await setRelated(true);
  const final = expectBang ? h : await health();
  return { height, ms: Date.now() - at, badge: final.badge, missing: final.entry?.missing, reportedAfterInjection: final.entry?.ts > at };
}
const outside = await injected("outside");
check("F4 LEAKS.search: shelf outside #contents → '!' naming related", outside.badge === "!" && outside.missing?.includes("related"), outside);
const inside = await injected("inside");
check("F4 LEAKS.search: shelf inside #contents is hidden → no '!'", inside.reportedAfterInjection && inside.height === 0 && inside.badge !== "!", inside);
const off = await injected("outside", false);
check("F4 LEAKS.search: Recommendations off + visible shelf → no '!'", off.reportedAfterInjection && off.height > 0 && off.badge !== "!", off);

await finish(ctx, check);
save("SS-search-shelves.json");
await context.close();
