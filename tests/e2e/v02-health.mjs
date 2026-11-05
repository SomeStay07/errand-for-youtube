import { join } from "node:path";
import { launch, reporter, searchVideoUrls, sleep, until, openRealPopup, closeWelcome, healthOf, newTab, trackHealthCycles, healthCycles, finish, messages, OUT } from "./harness.mjs";

const { check, save } = reporter();
const { msg } = messages();
const ctx = await launch({ name: "health" });
const { context } = ctx;
await closeWelcome(ctx);

const W = context.pages()[0] || (await context.newPage());
const urls = await searchVideoUrls(W, undefined, 6);
if (urls.length < 3) throw new Error(`search returned ${urls.length} watch URLs, need 3`);
const BREAKAGE = await ctx.worker.evaluate(() => globalThis.ErrandLib.BREAKAGE_URL);
const DELAY = await ctx.worker.evaluate(() => globalThis.ErrandLib.HEALTH_DELAY_MS);
const popupErrors = [];
const readHealth = (popup) => popup.eval(() => {
  const n = document.getElementById("health");
  return { cls: n.className, text: n.textContent, hidden: n.hidden, links: [...n.querySelectorAll("a")].map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel })) };
});

async function watchTab(url, script) {
  const { page, tabId } = await newTab(ctx);
  await trackHealthCycles(page);
  if (script) await page.addInitScript(script.fn, script.arg);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const { value: cycles } = await until(() => healthCycles(page), (c) => c.length > 0, 15000, 100);
  return { page, tabId, t0: cycles[0]?.at ?? null };
}

const healthy = await watchTab(urls[0]);
const { value: hW } = await until(() => healthOf(ctx, healthy.tabId), (h) => h.entry?.ts > healthy.t0, 4 * DELAY, 250);
let popup = await openRealPopup(ctx, healthy.page);
const healthyPopup = await readHealth(popup);
popupErrors.push(...popup.consoleErrors);
await popup.screenshot(join(OUT, "D-popup-healthy.png"));
check("D healthy watch page: clean health entry, no 'Known issues' link, no '!'", hW.entry?.missing.length === 0 && healthyPopup.cls === "ok" && !healthyPopup.links.some((l) => l.href === BREAKAGE) && hW.badge !== "!", { health: hW, popup: healthyPopup.text, links: healthyPopup.links.length });
await popup.close();
await healthy.page.close();

const rename = {
  fn: () => {
    setInterval(() => {
      const r = document.querySelector("ytd-watch-flexy #related");
      if (r) r.id = "related-renamed";
    }, 100);
  },
};
const forced = await watchTab(urls[1], rename);
const bangs = [];
await until(
  async () => {
    const h = await healthOf(ctx, forced.tabId);
    if (h.badge === "!" && !bangs.length) bangs.push({ at: Date.now(), entry: h.entry });
    return h;
  },
  () => bangs.length > 0,
  forced.t0 + 4 * DELAY - Date.now(),
  200,
);
const bangAfter = bangs.length ? bangs[0].at - forced.t0 : null;
check("F8 forced missing #related: no '!' after the first failed check", bangAfter === null || bangAfter >= 2 * DELAY - 1000, { bangAfterMs: bangAfter, cycleStart: forced.t0 });
check("F8 forced missing #related: '!' after the second check (12–20 s after the check cycle starts)", bangAfter !== null && bangAfter >= 2 * DELAY - 1000 && bangAfter <= 2 * DELAY + 8000 && bangs[0].entry?.missing.includes("related"), { bangAfterMs: bangAfter, entry: bangs[0]?.entry ?? null });
popup = await openRealPopup(ctx, forced.page);
const warn = await readHealth(popup);
popupErrors.push(...popup.consoleErrors);
await popup.screenshot(join(OUT, "D-popup-missing-related.png"));
const known = warn.links.find((l) => l.href === BREAKAGE);
const report = warn.links[0];
check("D popup warn line ends with 'Report it · Known issues'", warn.cls === "warn" && warn.text.endsWith(`${msg("reportThis")} · ${msg("breakageLink")}`) && warn.links.length === 2, warn.text);
check("D 'Known issues' → breakage page, new tab, noopener", Boolean(known) && known.text === msg("breakageLink") && known.target === "_blank" && known.rel === "noopener" && /\/breakage\/$/.test(known.href), known ?? null);
check("D 'Report it' opens in a new tab", report?.target === "_blank" && report?.text === msg("reportThis"), report ?? null);
const opened = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
await popup.click(`#health a[href="${BREAKAGE}"]`);
const breakage = await opened;
if (breakage) await breakage.waitForURL((u) => u.href.startsWith(BREAKAGE), { timeout: 8000 }).catch(() => {});
check("D clicking 'Known issues' opens the breakage URL in a new tab", Boolean(breakage) && breakage.url().startsWith(BREAKAGE), breakage?.url() ?? "no new tab");
if (breakage) {
  await breakage.screenshot({ path: join(OUT, "D-breakage-page.png") }).catch(() => {});
  await breakage.close();
}
await popup.close().catch(() => {});
await forced.page.close();

const glitch = await watchTab(urls[2], {
  fn: (delay) => {
    window.__glitch = {};
    const start = () => {
      const t0 = Date.now();
      setTimeout(() => {
        window.__glitch.timer = setInterval(() => {
          const r = document.querySelector("ytd-watch-flexy #related");
          if (!r) return;
          r.id = "related-renamed";
          window.__glitch.renamedAt ??= Date.now() - t0;
        }, 50);
      }, delay - 2000);
      setTimeout(() => {
        clearInterval(window.__glitch.timer);
        const r = document.getElementById("related-renamed");
        if (r) r.id = "related";
        window.__glitch.restoredAt = Date.now() - t0;
      }, delay + 2000);
    };
    new MutationObserver((_, obs) => {
      if (!document.getElementById("er-intent")) return;
      obs.disconnect();
      start();
    }).observe(document, { childList: true, subtree: true });
  },
  arg: DELAY,
});
let glitchBang = false;
const { value: hGlitch } = await until(
  async () => {
    const h = await healthOf(ctx, glitch.tabId);
    glitchBang ||= h.badge === "!";
    return h;
  },
  (h) => h.entry?.ts >= glitch.t0 + 2 * DELAY - 1000,
  glitch.t0 + 4 * DELAY - Date.now(),
  250,
);
await sleep(1000);
const after = await healthOf(ctx, glitch.tabId);
const window_ = await glitch.page.evaluate(() => window.__glitch);
const covered = window_.renamedAt !== undefined && window_.renamedAt <= DELAY - 500 && window_.restoredAt >= DELAY + 500;
check("F8 one-time glitch around the first check → no '!', the second check reports clean", covered ? !glitchBang && after.badge !== "!" && hGlitch.entry?.missing.length === 0 && hGlitch.entry.ts >= glitch.t0 + 2 * DELAY - 1000 : null, covered ? { entry: hGlitch.entry, glitch: window_ } : `precondition: #related was not renamed across the first check (${JSON.stringify(window_)})`);
await glitch.page.close();

await finish(ctx, check, { extra: popupErrors });
save("D-results.json");
await context.close();
