import { join } from "node:path";
import { launch, reporter, consent, searchVideoUrls, sleep, openRealPopup, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "health", port: 9345 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();

const W = context.pages()[0] || (await context.newPage());
const urls = await searchVideoUrls(W, undefined, 6);
const BREAKAGE = await ctx.worker.evaluate(() => globalThis.ErrandLib.BREAKAGE_URL);
const tabIds = () => ctx.worker.evaluate(() => chrome.tabs.query({}).then((t) => t.map((x) => x.id)));
const health = () => ctx.worker.evaluate(() => chrome.storage.session.get("health").then((d) => d.health || {}));
const badge = (tabId) => ctx.worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
const readHealth = (popup) => popup.eval(() => {
  const n = document.getElementById("health");
  return { cls: n.className, text: n.textContent, hidden: n.hidden, links: [...n.querySelectorAll("a")].map((a) => ({ text: a.textContent, href: a.href, target: a.target, rel: a.rel })) };
});

const before = new Set(await tabIds());
await W.goto(urls[0], { waitUntil: "domcontentloaded" });
await sleep(9000);
const wId = (await tabIds()).find((id) => !before.has(id)) ?? Object.keys(await health()).map(Number)[0];
const hW = (await health())[wId];
let popup = await openRealPopup(ctx, W);
const healthy = await readHealth(popup);
await popup.screenshot(join(OUT, "D-popup-healthy.png"));
check("D healthy watch page: no 'Known issues' link, no '!'", healthy.cls === "ok" && !healthy.links.some((l) => l.href === BREAKAGE) && (await badge(wId)) !== "!", `health=${JSON.stringify(hW)} popup="${healthy.text}" links=${healthy.links.length}`);
await popup.close();

await W.goto(urls[1], { waitUntil: "domcontentloaded" });
await sleep(1500);
await W.evaluate(() => {
  window.__ren = setInterval(() => {
    const r = document.querySelector("ytd-watch-flexy #related");
    if (r) r.id = "related-renamed";
  }, 100);
});
await sleep(7500);
const badgeEarly = await badge(wId);
check("F8 forced missing #related: no '!' after one failed check (9 s)", badgeEarly !== "!", `badge="${badgeEarly}" health=${JSON.stringify((await health())[wId])}`);
await sleep(4500);
const hForced = (await health())[wId];
const badgeForced = await badge(wId);
popup = await openRealPopup(ctx, W);
const forced = await readHealth(popup);
await popup.screenshot(join(OUT, "D-popup-missing-related.png"));
const known = forced.links.find((l) => l.href === BREAKAGE);
const report = forced.links[0];
check("D forced missing #related: badge '!' on the tab", badgeForced === "!", `badge="${badgeForced}" health=${JSON.stringify(hForced)}`);
check("D popup warn line: '… Report it · Known issues'", forced.cls === "warn" && /Report it · Known issues$/.test(forced.text) && forced.links.length === 2, forced.text);
check("D 'Known issues' → breakage page, new tab, noopener", Boolean(known) && known.text === "Known issues" && known.target === "_blank" && known.rel === "noopener" && /\/breakage\/$/.test(known.href), JSON.stringify(known));
check("D 'Report it' opens in a new tab", report?.target === "_blank" && report?.text === "Report it", JSON.stringify(report).slice(0, 160));
await popup.click(`#health a[href="${BREAKAGE}"]`);
await sleep(4000);
const listed = (await (await fetch(`http://127.0.0.1:${ctx.port}/json/list`)).json()).filter((t) => t.type === "page");
const bt = listed.find((t) => t.url.startsWith(BREAKAGE));
const newTab = context.pages().find((p) => p.url().startsWith(BREAKAGE));
check("D clicking 'Known issues' opens the breakage URL in a new tab", Boolean(bt), `${bt ? `${bt.url} title="${bt.title}"` : `pages: ${listed.map((t) => t.url).join(", ")}`}`);
if (newTab) {
  await newTab.screenshot({ path: join(OUT, "D-breakage-page.png") });
  await newTab.close();
}
await popup.close().catch(() => {});
await W.evaluate(() => clearInterval(window.__ren));

await W.goto(urls[4], { waitUntil: "domcontentloaded" });
const glitchAt = Date.now();
await sleep(4000);
await W.evaluate(() => {
  window.__ren = setInterval(() => {
    const r = document.querySelector("ytd-watch-flexy #related");
    if (r) r.id = "related-renamed";
  }, 100);
});
await sleep(4000);
await W.evaluate(() => {
  clearInterval(window.__ren);
  const r = document.getElementById("related-renamed");
  if (r) r.id = "related";
});
await sleep(Math.max(0, 16000 - (Date.now() - glitchAt)));
const hGlitch = (await health())[wId];
const badgeGlitch = await badge(wId);
check("F8 one-time glitch (#related gone 4–8 s around the first check) → no '!' at 16 s, entry clean", badgeGlitch !== "!" && hGlitch?.missing.length === 0 && Date.now() - hGlitch.ts < 12000, `badge="${badgeGlitch}" health=${JSON.stringify(hGlitch)}`);

async function hiddenRun(label, rename) {
  const ids0 = new Set(await tabIds());
  const X = await context.newPage();
  await sleep(300);
  const xId = (await tabIds()).find((id) => !ids0.has(id));
  const Y = await context.newPage();
  await Y.goto(`chrome-extension://${ctx.extId}/popup.html`);
  await Y.bringToFront();
  const xcdp = await context.newCDPSession(X);
  const { windowId } = await xcdp.send("Browser.getWindowForTarget");
  await xcdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  await sleep(500);
  await X.goto(urls[label === "forced" ? 2 : 3], { waitUntil: "domcontentloaded" });
  const hidden = await X.evaluate(() => document.hidden);
  if (rename) {
    await sleep(1500);
    await X.evaluate(() => {
      window.__ren = setInterval(() => {
        const r = document.querySelector("ytd-watch-flexy #related");
        if (r) r.id = "related-renamed";
      }, 100);
    });
  }
  await sleep(12000);
  const whileHidden = (await health())[xId];
  const badgeHidden = await badge(xId);
  await xcdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await X.bringToFront();
  const frontAt = Date.now();
  let after = null;
  while (Date.now() - frontAt < 18000 && !after) {
    after = (await health())[xId] || null;
    if (!after) await sleep(250);
  }
  const ms = Date.now() - frontAt;
  const badgeAfter = await badge(xId);
  await Y.close();
  await X.close();
  return { xId, hidden, whileHidden, badgeHidden, after, ms, badgeAfter };
}

const h1 = await hiddenRun("forced", true);
check("E2 no health result while the tab is hidden (forced missing #related)", h1.hidden && h1.whileHidden === undefined && h1.badgeHidden !== "!", `document.hidden=${h1.hidden}; 12 s hidden → health=${JSON.stringify(h1.whileHidden)} badge="${h1.badgeHidden}"`);
check("E2 check runs after the tab comes to front", h1.after !== null && h1.ms >= 11500 && h1.after.missing.includes("related") && h1.badgeAfter === "!", `result ${h1.ms} ms after bringToFront: ${JSON.stringify(h1.after)} badge="${h1.badgeAfter}"`);
const h2 = await hiddenRun("clean", false);
check("E2 background-loaded healthy video: no false '!' after switching to it", h2.hidden && h2.whileHidden === undefined && h2.after && h2.after.missing.length === 0 && h2.badgeAfter !== "!", `hidden=${h2.hidden} whileHidden=${JSON.stringify(h2.whileHidden)} after ${h2.ms} ms: ${JSON.stringify(h2.after)} badge="${h2.badgeAfter}"`);

const swErrs = await ctx.worker.evaluate(() => globalThis.__errs || []);
console.log("errors:", JSON.stringify([...ctx.errors, ...swErrs, ...(popup.consoleErrors || [])], null, 1));
save("D-results.json");
await context.close();
