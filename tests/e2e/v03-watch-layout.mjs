import { join } from "node:path";
import { launch, reporter, consent, sleep, searchVideoUrls, forceWatchLayout, OUT } from "./harness.mjs";

const { check, save } = reporter();
const MODES = (process.env.MODES || "forced,baseline").split(",");
const COMMENTS_PANEL = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]';

for (const [i, mode] of MODES.entries()) {
  const forced = mode === "forced";
  const ctx = await launch({ name: `v03-layout-${mode}`, port: 9371 + i, width: 1280, height: 900 });
  const { context } = ctx;
  await sleep(1500);
  for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
  const page = context.pages()[0] || (await context.newPage());
  if (forced) await forceWatchLayout(page);
  const W = ctx.worker;
  const LEAK = await W.evaluate(() => globalThis.ErrandLib.WATCH_LEAK);
  const settings = () => W.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => globalThis.ErrandLib.mergeSettings(settings)));
  const setSettings = (patch) => W.evaluate((p) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.mergeSettings(settings), ...p } })), patch);
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
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await consent(page);
    await page.waitForSelector("ytd-watch-flexy", { timeout: 20000 }).catch(() => {});
  };
  const testable = (ok, l) => (forced && !l.split ? null : ok);

  const urls = await searchVideoUrls(page, undefined, 6);
  await open(urls[0]);
  await sleep(9000);
  const l1 = await layout();
  await page.screenshot({ path: join(OUT, `WL-${mode}-1280.png`) });
  check(`F6 ${mode} 1280: ${forced ? "split-scroll layout, " : ""}#related hidden, reveal before #related, health ok, 0 WATCH_LEAK`, testable(!l1.relatedVisible && l1.revealBeforeRelated && l1.health === "ok" && l1.leaks === 0, l1), l1);

  if (forced) {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await open(urls[0]);
    await sleep(9000);
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
  await sleep((revealSeconds + 1) * 1000);
  const revealed = await page.evaluate(() => [...document.querySelectorAll("ytd-watch-flexy #related yt-lockup-view-model, ytd-watch-flexy #related ytd-compact-video-renderer")].filter((n) => n.getBoundingClientRect().height > 0).length);
  await recheck();
  await sleep(14000);
  const hr = await health();
  check(`F6 ${mode}: reveal → ≥10 lockups in #related, then 2 checks without 'related'`, testable(revealed >= 10 && hr.entry && !hr.entry.missing.includes("related"), l1), { revealed, hr });

  await open(urls[2]);
  await page.waitForSelector("ytd-watch-flexy #below", { state: "attached", timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const fake = document.createElement("yt-lockup-view-model");
    fake.id = "qa-watch-leak";
    fake.style.cssText = "display:block;height:90px;background:#c00";
    document.querySelector("ytd-watch-flexy #below")?.append(fake);
  });
  await recheck();
  const leakAt = Date.now();
  let leak = await health();
  while (Date.now() - leakAt < 15000 && !(leak.badge === "!" && leak.entry?.missing.includes("related"))) {
    await sleep(500);
    leak = await health();
  }
  const leakMs = Date.now() - leakAt;
  check(`F6 ${mode}: lockup in #below outside #related → '!' naming related within 15 s of a check start`, testable(leak.badge === "!" && leak.entry?.missing.includes("related"), l1), { leakMs, leak });
  await page.evaluate(() => document.getElementById("qa-watch-leak")?.remove());
  await recheck();
  await sleep(7000);
  const healed = await health();
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
    await open(url);
    await sleep(15000);
    const h = await health();
    check(`F6 ${mode} ${label}: no '!' after 2 checks`, testable(h.badge !== "!" && h.entry?.missing.length === 0, l1), { url, h });
  }
  if (!pl) check(`F6 ${mode} playlist`, null, "no PL playlist found in search");
  if (!live) check(`F6 ${mode} live`, null, "no live stream found in search");

  await setSettings(await W.evaluate(() => globalThis.ErrandLib.applyPreset({}, "shorts")));
  await open(urls[4]);
  await sleep(15000);
  const g = await health();
  check(`F6 ${mode} 'Just hide Shorts': no related leak`, !g.entry?.missing.includes("related") && g.badge !== "!", g);

  const errs = [...ctx.errors, ...(await W.evaluate(() => globalThis.__errs || []))];
  check(`${mode}: no extension errors`, errs.length === 0, errs);
  await context.close();
}
save("WL-watch-layout.json");
