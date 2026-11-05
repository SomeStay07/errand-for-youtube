import { join } from "node:path";
import { launch, reporter, consent, searchVideoUrls, storage, sleep, until, openRealPopup, closeWelcome, finish, messages, OUT } from "./harness.mjs";

const { check, save } = reporter();
const { msg } = messages();
const ctx = await launch({ name: "pause" });
const { context } = ctx;
await closeWelcome(ctx);
const popupErrors = [];

const A = context.pages()[0] || (await context.newPage());
const urls = await searchVideoUrls(A, undefined, 3);
await A.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(A);
const B = await context.newPage();
await B.goto(urls[0], { waitUntil: "domcontentloaded" });
await sleep(8000);
await A.bringToFront();
await sleep(1000);

const stateA = () => A.evaluate(() => ({
  showHome: document.documentElement.hasAttribute("data-er-show-home"),
  question: Boolean(document.getElementById("er-intent")) && getComputedStyle(document.getElementById("er-intent")).display !== "none",
  strict: document.documentElement.hasAttribute("data-er-strict"),
  hidden: document.hidden,
}));
const stateB = () => B.evaluate(() => {
  const r = document.documentElement;
  return {
    showRelated: r.hasAttribute("data-er-show-related"),
    showComments: r.hasAttribute("data-er-show-comments"),
    noAutoplay: r.hasAttribute("data-er-no-autoplay"),
    strict: r.hasAttribute("data-er-strict"),
    reveal: document.querySelectorAll("#er-reveal").length,
    commentsBtn: document.querySelectorAll("#er-comments").length,
    relatedVisible: Boolean(document.querySelector("ytd-watch-flexy #related")?.getClientRects().length),
    hidden: document.hidden,
  };
});
const badge = async (tabId) => ctx.worker.evaluate((id) => chrome.action.getBadgeText(id === undefined ? {} : { tabId: id }), tabId);
const tabIds = async () => {
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  return Object.fromEntries(Object.entries(health).map(([id, v]) => [v.page, Number(id)]));
};

const b0 = await stateB();
check("C baseline: watch tab has reveal + comments buttons", b0.reveal === 1 && b0.commentsBtn === 1 && !b0.showRelated, b0);
console.log("A visibility:", await stateA());

const observe = (page, attr) => page.evaluate((a) => {
  const r = document.documentElement;
  const init = r.hasAttribute(a);
  window.__flip = null;
  window.__obs?.disconnect();
  window.__obs = new MutationObserver(() => {
    if (window.__flip === null && r.hasAttribute(a) !== init) window.__flip = Date.now();
  });
  window.__obs.observe(r, { attributes: true, attributeFilter: [a] });
}, attr);
await ctx.worker.evaluate(() => {
  globalThis.__pauseSet = null;
  chrome.storage.onChanged.addListener((c) => {
    if (c.pausedUntil?.newValue) globalThis.__pauseSet = Date.now();
  });
});

let popup = await openRealPopup(ctx, A);
const pstate = () => popup.eval(() => {
  const b = document.getElementById("pauseButton");
  return { text: b.textContent, disabled: b.disabled, rowHidden: document.getElementById("pause").hidden, status: document.getElementById("status").textContent, healthHidden: document.getElementById("health").hidden, health: document.getElementById("health").textContent };
});
const p0 = await pstate();
check("C popup idle: 'Pause 15 min' enabled", p0.text === "Pause 15 min" && !p0.disabled && !p0.rowHidden, p0);
await popup.click("#pauseButton");
const cancelSamples = [];
const tc = Date.now();
while (Date.now() - tc < 5200) {
  cancelSamples.push(await pstate());
  await sleep(200);
}
await popup.close();
const closedAt = Date.now();
const { value: afterClose } = await until(() => storage(ctx, "pausedUntil"), (x) => Number.isFinite(x.pausedUntil), 12000, 250);
const { value: aAfterClose } = await until(stateA, (a) => a.showHome, 3000, 100);
const lastBeforeClose = cancelSamples.at(-1).text;
check("C1 closing popup mid-countdown does not cancel; the background starts the pause", Number.isFinite(afterClose.pausedUntil) && aAfterClose.showHome, `closed at "${lastBeforeClose}", then pausedUntil=${afterClose.pausedUntil}, home feed shown=${aAfterClose.showHome}`);
await ctx.worker.evaluate(() => chrome.storage.local.remove("pausedUntil"));
await sleep(1500);

await observe(A, "data-er-show-home");
await observe(B, "data-er-show-related");
popup = await openRealPopup(ctx, A);
await popup.click("#pauseButton");
const clickAt = Date.now();
const seq = [];
while (Date.now() - clickAt < 13000) {
  const s = await pstate();
  if (!seq.length || seq.at(-1).text !== s.text) seq.push({ t: Date.now() - clickAt, text: s.text, disabled: s.disabled });
  if (s.text === "Turn back on") break;
  await sleep(100);
}
const countdown = seq.filter((x) => /Pausing in/.test(x.text)).map((x) => Number(x.text.match(/\d+/)[0]));
const gaps = countdown.slice(1).reduce((n, v, i) => n + (countdown[i] - v - 1), 0);
const doneAt = seq.at(-1).text === "Turn back on" ? seq.at(-1).t : null;
check("C1 countdown runs 10…1 (decreasing, ≤ 1 missed sample), 'Turn back on' after 9.5–11.5 s", [9, 10].includes(countdown[0]) && countdown.at(-1) === 1 && countdown.every((v, i) => i === 0 || v < countdown[i - 1]) && gaps <= 1 && doneAt !== null && doneAt >= 9500 && doneAt <= 11500, `${countdown.join(",")}; seq=${seq.map((x) => `${x.t}ms:${x.text}`).join(" | ")}`);
check("C1 countdown button stays enabled so a second click can cancel", seq.filter((x) => /Pausing/.test(x.text)).every((x) => !x.disabled), seq.map((x) => x.disabled).join(","));
await popup.screenshot(join(OUT, "C-popup-paused.png"));
await sleep(1600);
const setAt = await ctx.worker.evaluate(() => globalThis.__pauseSet);
const flipA = await A.evaluate(() => window.__flip);
const flipB = await B.evaluate(() => window.__flip);
const dA = flipA && setAt ? flipA - setAt : null;
const dB = flipB && setAt ? flipB - setAt : null;
const { pausedUntil } = await storage(ctx, "pausedUntil");
check("C2 pausedUntil = now + 15 min", Math.abs(pausedUntil - setAt - 900000) < 1500, `${pausedUntil - setAt} ms`);
check("C3 both YouTube tabs switch within 1.5 s", dA !== null && dB !== null && dA <= 1500 && dB <= 1500, `front home tab +${dA} ms, background watch tab +${dB} ms after storage write`);
const aP = await stateA();
const bP = await stateB();
check("C2 home during pause: feed shown, no question", aP.showHome && !aP.question, aP);
check("C2 watch during pause: related shown, no reveal/comments buttons, no no-autoplay attr", bP.showRelated && bP.showComments && bP.reveal === 0 && bP.commentsBtn === 0 && !bP.noAutoplay, bP);
const pp = await pstate();
check("C3 popup status 'Paused until HH:MM', health hidden", /^Paused until \d{1,2}:\d\d( [AP]M)?\. YouTube is as is\.$/.test(pp.status) && pp.healthHidden && pp.text === "Turn back on" && !pp.disabled, pp);
const ids = await tabIds();
const badgeGlobal = await badge();
const badgeA = ids.home !== undefined ? await badge(ids.home) : null;
const badgeB = ids.watch !== undefined ? await badge(ids.watch) : null;
check("C badge 'II' during pause (global + both tabs)", badgeGlobal === "II" && badgeA === "II" && badgeB === "II", `global="${badgeGlobal}" home tab="${badgeA}" watch tab="${badgeB}" ids=${JSON.stringify(ids)}`);
const bgColor = await ctx.worker.evaluate(() => chrome.action.getBadgeBackgroundColor({}));
check("C badge colour grey #5f6368", bgColor.join() === "95,99,104,255", bgColor.join());

if (!(await popup.isOpen())) popup = await openRealPopup(ctx, A);
await popup.click("#pauseButton");
const resumeClick = Date.now();
let resumedIn = null;
for (let i = 0; i < 40; i++) {
  const b = await stateB();
  if (!b.showRelated && b.reveal === 1 && b.commentsBtn === 1) {
    resumedIn = Date.now() - resumeClick;
    break;
  }
  await sleep(100);
}
const afterResume = await storage(ctx, "pausedUntil");
await sleep(500);
const badgeAfterResume = await badge();
const aR = await stateA();
check("C4 'Turn back on' instant: hiding + buttons back, storage cleared", resumedIn !== null && resumedIn < 1500 && afterResume.pausedUntil === undefined && !aR.showHome, `watch tab restored in ${resumedIn} ms; home question back=${!aR.showHome}`);
check("C4 badge cleared after 'Turn back on'", badgeAfterResume === "", `"${badgeAfterResume}"`);
await popup.click("#pauseButton");
const { value: started } = await until(() => storage(ctx, ["pauseStartsAt", "pausedUntil"]), (s) => Number.isFinite(s.pauseStartsAt), 2000, 50);
await popup.click("#pauseButton");
const { value: cancelled } = await until(() => storage(ctx, ["pauseStartsAt", "pausedUntil"]), (s) => s.pauseStartsAt === undefined, 2000, 50);
const cancelText = await pstate();
check("C second click during the countdown cancels it", Number.isFinite(started.pauseStartsAt) && cancelled.pauseStartsAt === undefined && cancelled.pausedUntil === undefined && cancelText.text === msg("pauseButton"), { started, cancelled, button: cancelText.text });
await sleep(11500);
const afterCancel = await storage(ctx, "pausedUntil");
check("C cancelled countdown never starts a pause", afterCancel.pausedUntil === undefined && (await stateA()).showHome === false, afterCancel);
popupErrors.push(...popup.consoleErrors);
await popup.close().catch(() => {});

const pauseEnd = Date.now() + 20000;
await ctx.worker.evaluate((u) => chrome.storage.local.set({ pausedUntil: u }), pauseEnd);
await sleep(2000);
const bMid = await stateB();
const aMid = await stateA();
const badgeMid = await badge();
check("C5 pausedUntil=now+20s takes effect", bMid.showRelated && bMid.reveal === 0 && aMid.showHome && badgeMid === "II", { bMid, home: aMid.showHome, badgeMid });
let hidingBackAt = null;
let buttonsBackAt = null;
let badgeClearAt = null;
const deadline = pauseEnd + 75000;
while (Date.now() < deadline) {
  const b = await stateB();
  const a = await stateA();
  const now = Date.now();
  if (hidingBackAt === null && !b.showRelated && !a.showHome) hidingBackAt = now - pauseEnd;
  if (buttonsBackAt === null && b.reveal === 1 && b.commentsBtn === 1) buttonsBackAt = now - pauseEnd;
  if (badgeClearAt === null && (await badge()) === "") badgeClearAt = now - pauseEnd;
  if (hidingBackAt !== null && buttonsBackAt !== null && badgeClearAt !== null) break;
  if (now > pauseEnd + 5000 && hidingBackAt !== null && buttonsBackAt === null && now < pauseEnd + 6000) await B.screenshot({ path: join(OUT, "C-auto-resume-watch.png") });
  await sleep(250);
}
const bEnd = await stateB();
check("C5 auto-resume without reload: hiding returns in both tabs", hidingBackAt !== null && hidingBackAt < 1500, `hiding back at +${hidingBackAt} ms after pausedUntil`);
check("C5 badge cleared after auto-resume", badgeClearAt !== null && badgeClearAt < 2000, `+${badgeClearAt} ms`);
check("C5 reveal/comments buttons come back after auto-resume", buttonsBackAt !== null, `buttons back at ${buttonsBackAt === null ? "never (waited 75 s, includes the 60 s apply() fallback)" : `+${buttonsBackAt} ms`}; final watch state ${JSON.stringify(bEnd)}`);
await B.screenshot({ path: join(OUT, "C-after-auto-resume-watch.png") });

await B.goto(urls[1], { waitUntil: "domcontentloaded" });
await sleep(7000);
const bFresh = await stateB();
console.log("watch after a fresh navigation:", JSON.stringify(bFresh));

await ctx.worker.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 10 * 60 * 1000 }));
await sleep(1500);
popup = await openRealPopup(ctx, A);
const beforeStrict = await pstate();
await popup.eval(() => {
  const s = document.getElementById("mode");
  s.value = "strict";
  s.dispatchEvent(new Event("change"));
});
await sleep(1500);
const ps = await pstate();
const aS = await stateA();
const bS = await stateB();
const badgeStrict = await badge();
await popup.screenshot(join(OUT, "C-popup-strict.png"));
check("C6 strict hides the pause row", beforeStrict.rowHidden === false && ps.rowHidden === true, `before: hidden=${beforeStrict.rowHidden} "${beforeStrict.text}"; after: hidden=${ps.rowHidden}; status="${ps.status}"`);
check("C7 strict overrides an active pause at once", aS.strict && !aS.showHome && bS.strict && !bS.showRelated && bS.reveal === 0, { home: aS, watch: bS });
console.log(`badge while strict overrides pause: "${badgeStrict}"`);
await popup.eval(() => {
  const s = document.getElementById("mode");
  s.value = "relaxed";
  s.dispatchEvent(new Event("change"));
});
await sleep(1500);
const pr = await pstate();
const aBack = await stateA();
check("C7 leaving strict while pause still running: paused again, row shows 'Turn back on'", !pr.rowHidden && pr.text === "Turn back on" && aBack.showHome, { popup: pr, homeShowFeed: aBack.showHome });
await popup.click("#pauseButton");
await sleep(800);

popup = await openRealPopup(ctx, A);
await popup.click("#pauseButton");
await sleep(2600);
await popup.eval(() => {
  const s = document.getElementById("mode");
  s.value = "strict";
  s.dispatchEvent(new Event("change"));
});
await sleep(1000);
await popup.eval(() => {
  const s = document.getElementById("mode");
  s.value = "relaxed";
  s.dispatchEvent(new Event("change"));
});
await sleep(9000);
const stuck = await pstate();
const stuckStorage = await storage(ctx, "pausedUntil");
await popup.screenshot(join(OUT, "C-popup-strict-mid-countdown.png"));
check("C edge: strict toggled on/off mid-countdown leaves a usable button", !stuck.disabled && stuck.text === "Pause 15 min" && stuckStorage.pausedUntil === undefined, { button: stuck.text, disabled: stuck.disabled, pausedUntil: stuckStorage.pausedUntil });
await popup.close().catch(() => {});

await finish(ctx, check, { extra: [...popupErrors, ...(popup.consoleErrors || [])] });
save("C-results.json");
await context.close();
