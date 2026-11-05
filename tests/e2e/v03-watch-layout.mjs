import { join } from "node:path";
import { launch, reporter, consent, sleep, until, searchVideoUrls, forceWatchLayout, WATCH_GRID_FLAGS, closeWelcome, healthOf, recheck as recheckOf, settingsApi, finish, OUT } from "./harness.mjs";

const { check, save } = reporter();
const MODES = (process.env.MODES || "forced,grid,baseline").split(",");
const COMMENTS_PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]';

for (const mode of MODES) {
  const forced = mode === "forced";
  const ctx = await launch({ name: `v03-layout-${mode}`, width: 1280, height: 900 });
  const { context } = ctx;
  await closeWelcome(ctx);
  const page = context.pages()[0] || (await context.newPage());
  if (forced) await forceWatchLayout(page);
  if (mode === "grid") await forceWatchLayout(page, WATCH_GRID_FLAGS);
  const W = ctx.worker;
  const LEAK = await W.evaluate(() => globalThis.ErrandLib.WATCH_LEAK);
  const { get: settings, preset } = settingsApi(ctx);
  const recheck = () => recheckOf(ctx);
  const health = () => healthOf(ctx);
  const reportAfter = async (at, ms = 20000) => (await until(health, (h) => h.entry?.ts > at, ms, 500)).value;
  const layout = () =>
    page.evaluate((leak) => {
      const related = document.querySelector("ytd-watch-flexy #related");
      return {
        split: Boolean(document.querySelector("ytd-watch-flexy[split-scroll]")),
        relatedVisible: Boolean(related && related.getBoundingClientRect().height > 0),
        revealBeforeRelated: Boolean(related) && document.getElementById("er-reveal")?.nextElementSibling === related,
        health: document.documentElement.getAttribute("data-er-health"),
        leaks: [...document.querySelectorAll(leak)].filter((n) => n.getBoundingClientRect().height > 0).length,
      };
    }, LEAK);
  const open = async (url) => {
    const at = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await consent(page);
    await page.waitForSelector("ytd-watch-flexy", { timeout: 20000 }).catch(() => {});
    return at;
  };
  const testable = (ok, l) => (forced && !l.split ? null : ok);

  const urls = await searchVideoUrls(page, undefined, 6);
  if (urls.length < 5) throw new Error(`search returned ${urls.length} watch URLs, need 5`);
  if (mode === "grid") {
    const gridState = () =>
      page.evaluate((leak) => {
        const grid = document.querySelector("ytd-watch-grid #bottom-grid");
        const reveal = document.getElementById("er-reveal");
        const lockups = grid ? [...grid.querySelectorAll("yt-lockup-view-model, ytd-compact-video-renderer, ytd-rich-item-renderer")] : [];
        return {
          grid: Boolean(document.querySelector("ytd-watch-grid")),
          bottomGrid: Boolean(grid),
          revealBeforeGrid: Boolean(grid) && reveal?.nextElementSibling === grid,
          visibleLockups: lockups.filter((n) => n.getBoundingClientRect().height > 0).length,
          lockups: lockups.length,
          health: document.documentElement.getAttribute("data-er-health"),
          leaks: [...document.querySelectorAll(leak)].filter((n) => n.getBoundingClientRect().height > 0).length,
        };
      }, LEAK);
    const gridAt = await open(urls[0]);
    await reportAfter(gridAt, 25000);
    const g1 = await gridState();
    await page.screenshot({ path: join(OUT, "WL-grid-1280.png") });
    const gridOk = g1.grid && g1.bottomGrid;
    check("F6 grid (kevlar_watch_grid): reveal button mounted right before #bottom-grid, recommendations hidden, health ok, 0 WATCH_LEAK", gridOk ? g1.revealBeforeGrid && g1.visibleLockups === 0 && g1.health === "ok" && g1.leaks === 0 : null, gridOk ? g1 : `precondition: the kevlar_watch_grid flag did not take (${JSON.stringify(g1)})`);
    if (gridOk) {
      const { revealSeconds } = await settings();
      await page.locator("#er-reveal").click().catch(() => {});
      await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-er-reveal")), Boolean, (revealSeconds + 3) * 1000, 250);
      const { value: g2 } = await until(gridState, (x) => x.visibleLockups > 0, 5000, 250);
      const hr = await reportAfter(await recheck());
      check("F6 grid: reveal → #bottom-grid recommendations visible, next check without 'related'", g2.visibleLockups > 0 && Boolean(hr.entry) && !hr.entry.missing.includes("related"), { g2, hr });
    }
    await finish(ctx, check, { name: "grid: no extension errors" });
    await context.close();
    continue;
  }
  const firstAt = await open(urls[0]);
  await reportAfter(firstAt);
  const l1 = await layout();
  await page.screenshot({ path: join(OUT, `WL-${mode}-1280.png`) });
  check(`F6 ${mode} 1280: ${forced ? "split-scroll layout, " : ""}#related hidden, reveal before #related, health ok, 0 WATCH_LEAK`, testable(!l1.relatedVisible && l1.revealBeforeRelated && l1.health === "ok" && l1.leaks === 0, l1), l1);

  if (forced) {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await reportAfter(await open(urls[0]));
    const l2 = await layout();
    await page.screenshot({ path: join(OUT, `WL-${mode}-1920.png`) });
    check("F6 forced 1920: split-scroll layout, #related hidden, reveal before #related, health ok, 0 WATCH_LEAK", testable(!l2.relatedVisible && l2.revealBeforeRelated && l2.health === "ok" && l2.leaks === 0, l2), l2);
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(urls[0]);
    await sleep(4000);
  }

  await page.waitForSelector("#er-comments", { timeout: 10000 }).catch(() => {});
  await page.locator("#er-comments").click().catch(() => {});
  await sleep(800);
  const focus = await page.evaluate((panel) => {
    const a = document.activeElement;
    const p = document.querySelector(panel);
    return {
      active: a ? `${a.tagName.toLowerCase()}#${a.id}[${a.getAttribute("target-id") || ""}]` : null,
      onPanel: Boolean(p) && a === p,
      panelWidth: Math.round(p?.getBoundingClientRect().width ?? 0),
      onComments: a?.matches?.("ytd-comments#comments") ?? false,
      commentsHidden: document.querySelector("ytd-comments#comments")?.hidden ?? null,
    };
  }, COMMENTS_PANEL);
  if (forced) check("F6c forced: Show comments → comments panel visible and focused", testable(focus.onPanel && focus.panelWidth > 0, l1), focus);
  else check("F6c baseline: Show comments → focus on ytd-comments#comments", focus.onComments, focus);

  if (forced) {
    const rail = page.locator(".ytSideRailViewModelHost button, #fixed-side-menu button").first();
    await rail.click({ timeout: 5000 }).catch(() => {});
    await sleep(1000);
    const desc = await page.evaluate(() => Math.round(document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"]')?.getBoundingClientRect().width ?? 0));
    check("F6 forced: rail's first tab opens the description panel (not hidden by Errand)", testable(desc > 0, l1), { descWidth: desc });
  }

  const { revealSeconds } = await settings();
  await open(urls[1]);
  await page.waitForSelector("#er-reveal", { timeout: 15000 }).catch(() => {});
  await page.locator("#er-reveal").click().catch(() => {});
  await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-er-reveal")), Boolean, (revealSeconds + 3) * 1000, 250);
  const { value: revealed } = await until(() => page.evaluate(() => [...document.querySelectorAll("ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-flexy #related ytd-compact-video-renderer")].filter((n) => n.getBoundingClientRect().height > 0).length), (n) => n > 0, 5000, 250);
  const hr = await reportAfter(await recheck());
  check(`F6 ${mode}: reveal → lockups in #related visible, next check without 'related'`, testable(revealed > 0 && Boolean(hr.entry) && !hr.entry.missing.includes("related"), l1), { revealed, hr });

  await open(urls[2]);
  await page.waitForSelector("ytd-watch-flexy #below", { state: "attached", timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const fake = document.createElement("yt-lockup-view-model");
    fake.id = "qa-watch-leak";
    fake.style.cssText = "display:block;height:90px;background:#c00";
    document.querySelector("ytd-watch-flexy #below")?.append(fake);
  });
  const leakAt = await recheck();
  const { value: leak, ms: leakMs } = await until(health, (h) => h.badge === "!" && h.entry?.ts > leakAt && h.entry.missing.includes("related"), 20000, 500);
  check(`F6 ${mode}: lockup in #below outside #related → '!' naming related within 15 s of a check start`, testable(leak.badge === "!" && leak.entry?.missing.includes("related"), l1), { leakMs, leak });
  await page.evaluate(() => document.getElementById("qa-watch-leak")?.remove());
  const healed = await reportAfter(await recheck());
  check(`F6 ${mode}: leak removed → badge recovers`, testable(healed.badge !== "!" && healed.entry?.missing.length === 0, l1), healed);

  const vid = new URL(urls[3]).searchParams.get("v");
  const cases = [["Mix", `https://www.youtube.com/watch?v=${vid}&list=RD${vid}&start_radio=1`]];
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("python tutorial playlist")}&sp=EgIQAw%253D%253D`, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  const pl = await page.evaluate(() => [...document.querySelectorAll('a[href*="/watch"][href*="list=PL"]')].map((a) => a.getAttribute("href"))[0]);
  if (pl) cases.push(["playlist", `https://www.youtube.com${pl}`]);
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent("lofi hip hop radio")}&sp=EgJAAQ%253D%253D`, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  const live = await page.evaluate(() => document.querySelector('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]')?.getAttribute("href"));
  if (live) cases.push(["live", `https://www.youtube.com${live}`]);
  for (const [label, url] of cases) {
    const h = await reportAfter(await open(url), 25000);
    check(`F6 ${mode} ${label}: health verdict without '!'`, testable(Boolean(h.entry) && h.badge !== "!" && h.entry.missing.length === 0, l1), { url, h });
  }
  if (!pl) check(`F6 ${mode} playlist`, null, "precondition: no PL playlist found in search");
  if (!live) check(`F6 ${mode} live`, null, "precondition: no live stream found in search");

  await preset("shorts");
  const g = await reportAfter(await open(urls[4]), 25000);
  check(`F6 ${mode} 'Just hide Shorts': health verdict without a related leak`, Boolean(g.entry) && g.entry.page === "watch" && !g.entry.missing.includes("related") && g.badge !== "!", g);

  await finish(ctx, check, { name: `${mode}: no extension errors` });
  await context.close();
}
save("WL-watch-layout.json");
