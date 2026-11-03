import { join } from "node:path";
import { launch, reporter, consent, searchVideoUrls, storage, sleep, openRealPopup, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-pause-seq", port: 9391 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const A = context.pages()[0] || (await context.newPage());
const urls = await searchVideoUrls(A, undefined, 2);
await A.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(A);
const B = await context.newPage();
await B.goto(urls[0], { waitUntil: "domcontentloaded" });
await sleep(7000);
await A.bringToFront();
const flip = (page, attr) => page.evaluate((a) => {
  window.__flip = null;
  new MutationObserver(() => {
    if (window.__flip === null && document.documentElement.hasAttribute(a)) window.__flip = Date.now();
  }).observe(document.documentElement, { attributes: true, attributeFilter: [a] });
}, attr);
await flip(A, "data-er-show-home");
await flip(B, "data-er-show-related");
await ctx.worker.evaluate(() => {
  globalThis.__pauseSet = null;
  chrome.storage.onChanged.addListener((c) => {
    if (c.pausedUntil?.newValue) globalThis.__pauseSet = Date.now();
  });
});
const popup = await openRealPopup(ctx, A);
const read = () => popup.eval(() => ({ text: document.getElementById("pauseButton").textContent, disabled: document.getElementById("pauseButton").disabled, status: document.getElementById("status").textContent }));
await popup.click("#pauseButton");
const t0 = Date.now();
const seq = [];
while (Date.now() - t0 < 13000) {
  const s = await read();
  if (!seq.length || seq.at(-1).text !== s.text) seq.push({ t: Date.now() - t0, ...s });
  if (s.text === "Turn back on") break;
  await sleep(100);
}
const nums = seq.filter((x) => /Pausing in/.test(x.text)).map((x) => Number(x.text.match(/\d+/)[0]));
check("pause countdown 10…1 then 'Turn back on'", nums.join(",") === "10,9,8,7,6,5,4,3,2,1" && seq.at(-1).text === "Turn back on", seq.map((x) => `${x.t}ms:${x.text}${x.disabled ? "(disabled)" : ""}`).join(" | "));
check("countdown button enabled so a second click cancels (spec changed from 'disabled')", seq.filter((x) => /Pausing/.test(x.text)).every((x) => !x.disabled), seq.map((x) => x.disabled).join(","));
await sleep(1500);
const setAt = await ctx.worker.evaluate(() => globalThis.__pauseSet);
const { pausedUntil } = await storage(ctx, "pausedUntil");
const fa = await A.evaluate(() => window.__flip);
const fb = await B.evaluate(() => window.__flip);
check("pausedUntil = start + 15 min", Math.abs(pausedUntil - setAt - 900000) < 1500, `${pausedUntil - setAt} ms`);
check("both tabs switch within 1.5 s of the write, no reload", fa && fb && fa - setAt <= 1500 && fb - setAt <= 1500, `home +${fa - setAt} ms, watch +${fb - setAt} ms`);
const st = await read();
check("popup status 'Paused until HH:MM'", /^Paused until /.test(st.status), st.status);
await popup.screenshot(join(OUT, "Q-popup-paused.png"));
const badge = await ctx.worker.evaluate(() => chrome.action.getBadgeText({}));
check("toolbar badge 'II' during pause", badge === "II", badge);
const swErrs = await ctx.worker.evaluate(() => globalThis.__errs || []);
check("no extension errors", [...ctx.errors, ...swErrs, ...popup.consoleErrors].length === 0, [...ctx.errors, ...swErrs, ...popup.consoleErrors]);
save("Q-pause-seq.json");
await context.close();
