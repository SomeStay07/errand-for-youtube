import { join } from "node:path";
import { launch, reporter, consent, sleep, heap, closeWelcome, OUT, QUERY } from "./harness.mjs";

const CONTROL = process.env.CONTROL === "1";
const ROUNDS = Number(process.env.ROUNDS || 15);
const { check, save } = reporter();
const ctx = await launch({ name: CONTROL ? "regress-control" : "regress", extension: !CONTROL });
const { context } = ctx;
if (!CONTROL) await closeWelcome(ctx);
const page = context.pages()[0] || (await context.newPage());
const allConsoleErrors = [];
page.on("console", (m) => m.type() === "error" && allConsoleErrors.push(m.text().slice(0, 160)));

await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`, { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]', { timeout: 20000 });
await sleep(3000);

const watchState = () => page.evaluate(() => {
  const r = document.documentElement;
  return {
    reveal: document.querySelectorAll("#er-reveal").length,
    commentsBtn: document.querySelectorAll("#er-comments").length,
    showRelated: r.hasAttribute("data-er-show-related"),
    erNodes: document.querySelectorAll('[id^="er-"]').length,
    page: r.dataset.erPage,
  };
});

async function loop(label, expectPaused) {
  const bad = [];
  let navs = 0;
  const t0 = Date.now();
  for (let i = 0; i < ROUNDS; i++) {
    const links = page.locator('ytd-video-renderer a#thumbnail[href^="/watch"]');
    const n = await links.count();
    if (!n) {
      bad.push(`round ${i}: no result links`);
      break;
    }
    const link = links.nth(i % Math.min(n, 10));
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click({ timeout: 8000 }).catch((e) => bad.push(`round ${i}: click ${String(e).slice(0, 80)}`));
    await page.waitForURL(/watch/, { timeout: 15000 }).catch(() => bad.push(`round ${i}: no watch url`));
    navs++;
    let s;
    for (let k = 0; k < 12; k++) {
      await sleep(250);
      s = await watchState();
      if (CONTROL || (expectPaused ? s.reveal === 0 && s.showRelated : s.reveal === 1 && s.commentsBtn === 1)) break;
    }
    if (!CONTROL) {
      const ok = expectPaused ? s.reveal === 0 && s.commentsBtn === 0 && s.showRelated : s.reveal === 1 && s.commentsBtn <= 1 && !s.showRelated && s.page === "watch";
      if (!ok) bad.push(`round ${i} watch: ${JSON.stringify(s)}`);
    }
    await sleep(800);
    await page.goBack();
    await page.waitForURL(/results/, { timeout: 15000 }).catch(() => bad.push(`round ${i}: back failed`));
    navs++;
    await sleep(1200);
    if (!CONTROL) {
      const r = await watchState();
      if (r.reveal || r.commentsBtn || r.page !== "search") bad.push(`round ${i} results: ${JSON.stringify(r)}`);
    }
  }
  return { navs, bad, seconds: Math.round((Date.now() - t0) / 1000) };
}

const h0 = await heap(page);
const off = await loop("off", false);
const h1 = await heap(page);
await page.screenshot({ path: join(OUT, `F-${CONTROL ? "control" : "ext"}-after-off.png`) });
let on = null;
let h2 = null;
if (!CONTROL) {
  await ctx.worker.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 14 * 60 * 1000 }));
  await sleep(1500);
  on = await loop("on", true);
  h2 = await heap(page);
  await ctx.worker.evaluate(() => chrome.storage.local.remove("pausedUntil"));
} else {
  on = await loop("control-2", false);
  h2 = await heap(page);
}
console.log("heap:", JSON.stringify({ start: h0, afterOff: h1, afterOn: h2 }));
check(`F ${CONTROL ? "control " : ""}${off.navs} SPA navigations, pause off`, off.bad.length === 0, `${off.seconds}s; problems: ${JSON.stringify(off.bad)}`);
check(`F ${CONTROL ? "control " : ""}${on.navs} SPA navigations, pause on`, on.bad.length === 0, `${on.seconds}s; problems: ${JSON.stringify(on.bad)}`);
check(`F ${CONTROL ? "control " : ""}DOM nodes and listeners grow < 10 % from the first loop to the second`, h2.nodes <= h1.nodes * 1.1 && h2.listeners <= h1.listeners * 1.1, `start ${JSON.stringify(h0)} → after first loop ${JSON.stringify(h1)} → after second loop ${JSON.stringify(h2)}`);
let sw = [];
if (!CONTROL) sw = await ctx.worker.evaluate(() => globalThis.__errs || []);
check(`F ${CONTROL ? "control " : ""}extension console errors (page/SW)`, CONTROL || (ctx.errors.length === 0 && sw.length === 0), JSON.stringify([...ctx.errors, ...sw]));
console.log(`page console errors total (incl. YouTube's own): ${allConsoleErrors.length}`);
console.log([...new Set(allConsoleErrors)].slice(0, 12).join("\n"));
save(`F-${CONTROL ? "control" : "ext"}-results.json`);
await context.close();
