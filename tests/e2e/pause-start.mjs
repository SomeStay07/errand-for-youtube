import { launch, reporter, sleep } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "pause-start", port: 9351 });
const { context, extId } = ctx;
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();

const yt = context.pages()[0] || (await context.newPage());
await yt.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await sleep(3000);

const popup = await context.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
await sleep(800);
await popup.click("#pauseButton");
await sleep(300);
const text1 = await popup.locator("#pauseButton").textContent();
check("click starts a visible countdown", /\d/.test(text1), text1);
const starts = await popup.evaluate(() => chrome.storage.local.get("pauseStartsAt"));
check("countdown stored in storage", Number.isFinite(starts.pauseStartsAt), JSON.stringify(starts));
await sleep(2200);
const text2 = await popup.locator("#pauseButton").textContent();
check("countdown ticks down", text2 !== text1, `${text1} -> ${text2}`);
await popup.close();
await sleep(9000);
const probe = await context.newPage();
await probe.goto(`chrome-extension://${extId}/popup.html`);
await sleep(500);
const state = await probe.evaluate(() => chrome.storage.local.get(["pausedUntil", "pauseStartsAt"]));
check("pause starts even with the popup closed", Number.isFinite(state.pausedUntil) && state.pauseStartsAt === undefined, JSON.stringify(state));
check("YouTube shows the feed during pause", await yt.evaluate(() => document.documentElement.hasAttribute("data-er-show-home")));
check("popup offers Turn back on", /back/i.test(await probe.locator("#pauseButton").textContent()));

await probe.locator("#pauseButton").click();
await sleep(300);
await probe.locator("#pauseButton").click();
await sleep(300);
await probe.locator("#pauseButton").click();
await sleep(300);
const cancel = await probe.evaluate(() => chrome.storage.local.get(["pausedUntil", "pauseStartsAt"]));
check("second click during countdown cancels it", cancel.pauseStartsAt === undefined && cancel.pausedUntil === undefined, JSON.stringify(cancel));
await sleep(11000);
const after = await probe.evaluate(() => chrome.storage.local.get(["pausedUntil"]));
check("cancelled countdown never starts a pause", after.pausedUntil === undefined, JSON.stringify(after));

await save("pause-start");
await ctx.close?.();
await context.close();
