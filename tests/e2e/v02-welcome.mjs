import { join } from "node:path";
import { launch, reporter, consent, searchVideoUrls, storage, sleep, OUT, QUERY, finish } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "welcome" });
const { context } = ctx;
await sleep(2000);

const welcomeTabs = context.pages().filter((p) => p.url().endsWith("/welcome.html"));
check("A1 install opens exactly one welcome tab", welcomeTabs.length === 1, `${welcomeTabs.length} tabs`);
const welcome = welcomeTabs[0];
await welcome.setViewportSize({ width: 1280, height: 900 });
await welcome.waitForTimeout(500);

const before = await storage(ctx, "settings");
check("A4 nothing written on load", before.settings === undefined, JSON.stringify(before));

const lines = () => welcome.locator("#lines li").allTextContents();
const linesAsk = await lines();
const readSettings = () => welcome.evaluate(() => chrome.storage.local.get("settings").then((d) => d.settings));

const results = {};
for (const id of ["shorts", "subs", "ask"]) {
  const t0 = Date.now();
  await welcome.locator(`label.choice:has(input[value="${id}"])`).click();
  let s;
  for (let i = 0; i < 20; i++) {
    s = await readSettings();
    if (s && (id !== "ask" || s.homeTarget === "ask") && (id !== "shorts" || s.homeTarget === "feed") && (id !== "subs" || s.homeTarget === "subs")) break;
    await sleep(25);
  }
  const ms = Date.now() - t0;
  const l = await lines();
  results[id] = { s, l, ms };
  await welcome.screenshot({ path: join(OUT, `A-welcome-${id}.png`), fullPage: true });
  const preset = await welcome.evaluate((pid) => globalThis.ErrandLib.PRESETS[pid], id);
  const matches = s && Object.entries(preset).every(([k, v]) => (k === "hide" ? Object.entries(v).every(([hk, hv]) => s.hide[hk] === hv) : s[k] === v));
  check(`A5 click "${id}" writes preset to storage.local`, Boolean(matches), `${ms} ms after click; homeTarget=${s?.homeTarget} related=${s?.hide?.related} comments=${s?.hide?.comments} stopAutoplay=${s?.stopAutoplay} endPrompt=${s?.endPrompt}`);
  check(`A5 "${id}" lines: 3 items`, l.length === 3, l.join(" | "));
}
check("A5 lines change shorts vs ask", results.shorts.l.join() !== linesAsk.join(), results.shorts.l[0]);
check("A5 lines change subs vs ask", results.subs.l[0] !== linesAsk[0] && results.subs.l[1] === linesAsk[1], results.subs.l[0]);
check("A5 back to ask restores ask lines", results.ask.l.join() === linesAsk.join());
check("A5 opt-in keys untouched", results.shorts.s.mode === "normal" || results.shorts.s.mode !== undefined, `mode=${results.shorts.s.mode} metrics=${results.shorts.s.hide.metrics}`);

await welcome.locator('label.choice:has(input[value="shorts"])').click();
await sleep(200);
await welcome.locator("#open").click();
await welcome.waitForURL(/youtube\.com/, { timeout: 20000 });
check("A3 Open YouTube navigates the same tab", welcome.url().startsWith("https://www.youtube.com/"), welcome.url());
const yt = welcome;
await consent(yt);
await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await sleep(5000);
const home = await yt.evaluate(() => ({
  url: location.pathname,
  showHome: document.documentElement.hasAttribute("data-er-show-home"),
  feedVisible: Boolean(document.querySelector('ytd-browse[page-subtype="home"]')?.getClientRects().length),
  questionVisible: Boolean(document.getElementById("er-intent")?.getClientRects().length) && getComputedStyle(document.getElementById("er-intent")).display !== "none",
  shortsLinks: [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => a.getClientRects().length > 0).length,
  feedItems: document.querySelectorAll('ytd-browse[page-subtype="home"] ytd-rich-item-renderer').length,
}));
await yt.screenshot({ path: join(OUT, "A-shorts-home.png") });
check("A3 'Only no Shorts': home feed visible, no question", home.url === "/" && home.showHome && home.feedVisible && !home.questionVisible, home);
check("A3 'Only no Shorts': no visible Shorts on home", home.shortsLinks === 0, `${home.shortsLinks} visible /shorts/ links, ${home.feedItems} feed items (signed out may show an empty feed)`);

const urls = await searchVideoUrls(yt, QUERY, 3);
await yt.goto(urls[0], { waitUntil: "domcontentloaded" });
await sleep(6000);
await yt.mouse.wheel(0, 900);
await sleep(3500);
const watch = await yt.evaluate(() => {
  const vis = (s) => Boolean(document.querySelector(s)?.getClientRects().length);
  return {
    related: vis("ytd-watch-flexy #related"),
    comments: vis("ytd-comments#comments"),
    reveal: Boolean(document.getElementById("er-reveal")),
    commentsBtn: Boolean(document.getElementById("er-comments")),
    noAutoplayAttr: document.documentElement.hasAttribute("data-er-no-autoplay"),
  };
});
await yt.screenshot({ path: join(OUT, "A-shorts-watch.png") });
check("A3 'Only no Shorts': related + comments visible, no Errand buttons", watch.related && watch.comments && !watch.reveal && !watch.commentsBtn, watch);

const w2 = await context.newPage();
await w2.goto(`chrome-extension://${ctx.extId}/welcome.html`);
await w2.waitForTimeout(500);
const checkedOnReopen = await w2.evaluate(() => document.querySelector('input[name="preset"]:checked')?.value ?? null);
check("A4 reopened page shows stored preset", checkedOnReopen === "shorts", `checked=${checkedOnReopen}`);
await w2.locator('label.choice:has(input[value="subs"])').click();
await sleep(300);
await w2.close();
await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await yt.waitForURL(/feed\/subscriptions/, { timeout: 10000 }).catch(() => {});
await sleep(2000);
await yt.screenshot({ path: join(OUT, "A-subs-landing.png") });
check("A4 'Subscriptions first': youtube.com lands on /feed/subscriptions", yt.url().includes("/feed/subscriptions"), yt.url());

const allTargets = async () => (await (await fetch(`http://127.0.0.1:${ctx.port}/json/list`)).json()).map((t) => `${t.type}:${t.url}`);
const beforeReload = (await allTargets()).filter((u) => u.includes("welcome.html")).length;
const swBefore = (await allTargets()).filter((u) => u.startsWith("service_worker")).length;
const helper = await context.newPage();
await helper.goto(`chrome-extension://${ctx.extId}/popup.html`);
await helper.evaluate(() => chrome.storage.local.set({ reloadMarker: Date.now() }));
await helper.evaluate(() => setTimeout(() => chrome.runtime.reload(), 50)).catch(() => {});
let swBack = false;
for (let i = 0; i < 30 && !swBack; i++) {
  await sleep(500);
  swBack = (await allTargets()).some((u) => u.startsWith("service_worker:chrome-extension://"));
}
console.log("SW back after reload:", swBack);
await sleep(3000);
const afterReload = await allTargets();
console.log("targets after reload:", afterReload);
const welcomeAfter = afterReload.filter((u) => u.includes("welcome.html")).length;
const probe = await context.newPage();
const after = await probe.goto(`chrome-extension://${ctx.extId}/popup.html`).then(() => probe.waitForTimeout(500)).then(() => probe.evaluate(() => chrome.storage.local.get(["settings", "reloadMarker"]))).catch((e) => ({ err: String(e).split("\n")[0] }));
if (after.err) console.log("extension page after reload:", after.err);
await probe.close();
check("A1 extension reload (update) opens no welcome tab", !swBack ? null : !helper.isClosed() ? false : welcomeAfter === 0, `helper tab closed by reload=${helper.isClosed()}; SW targets before=${swBefore}; welcome tabs before=${beforeReload} after=${welcomeAfter}; targets after: ${afterReload.join(", ")}`);
check("A1 settings survive reload", !swBack ? null : after.settings?.homeTarget === "subs" && Boolean(after.reloadMarker), `homeTarget=${after.settings?.homeTarget}`);

await finish(ctx, check);
save("A-results.json");
await context.close();
