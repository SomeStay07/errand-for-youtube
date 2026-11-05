import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, consent, until, finish, sleep, QUERY } from "./harness.mjs";

const SHOTS = process.env.OUT || new URL("../../.e2e-out", import.meta.url).pathname;
const VIDEO = process.env.VIDEO === "1";
mkdirSync(SHOTS, { recursive: true });

const { check, save } = reporter();
const ctx = await launch({ name: "smoke", locale: process.env.LOCALE || "en-US", video: VIDEO ? { dir: join(SHOTS, "video"), size: { width: 1280, height: 800 } } : null });
const { context, extId } = ctx;
const HEALTH = Object.fromEntries(await ctx.worker.evaluate(() => globalThis.ErrandLib.HEALTH.watch));

const { value: welcome } = await until(async () => context.pages().find((p) => p.url().includes("welcome.html")) ?? null, Boolean, 10000, 200);
check("install: welcome page opened", Boolean(welcome));
if (welcome) {
  await welcome.waitForSelector("#lines li", { timeout: 5000 }).catch(() => {});
  check("welcome: ask preset selected", await welcome.locator('input[value="ask"]').isChecked());
  check("welcome: three lines", (await welcome.locator("#lines li").count()) === 3);
  await welcome.screenshot({ path: join(SHOTS, "0-welcome.png"), fullPage: true });
  await welcome.close();
}
const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await context.newPage());
const BLUR_CSS = `ytd-thumbnail img, yt-thumbnail-view-model img, yt-image img, #avatar img, yt-img-shadow img, .yt-spec-avatar-shape img, yt-avatar-shape img, ytd-channel-name, #channel-name, .ytContentMetadataViewModelMetadataRow a { filter: blur(9px) !important; }`;
const blurPage = async () => {
  await page.addStyleTag({ content: BLUR_CSS }).catch(() => {});
  await sleep(400);
};
const visible = (selector) => page.evaluate((s) => [...document.querySelectorAll(s)].some((n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden"), selector);
const attached = (selector) => page.evaluate((s) => Boolean(document.querySelector(s)), selector);

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("#er-intent", { state: "visible", timeout: 15000 }).catch(() => {});
const { value: homeBrowse } = await until(() => attached('ytd-browse[page-subtype="home"]'), Boolean, 10000);
check("home: question visible", await page.locator("#er-intent").isVisible());
check("home: feed rendered and hidden", homeBrowse && !(await visible('ytd-browse[page-subtype="home"]')), { rendered: homeBrowse });
await page.screenshot({ path: join(SHOTS, "1-home.png") });

await page.locator("#er-intent input").click();
await page.keyboard.type(QUERY, { delay: VIDEO ? 60 : 0 });
await sleep(VIDEO ? 800 : 100);
await page.screenshot({ path: join(SHOTS, "1b-home-typed.png") });
await page.keyboard.press("Enter");
await page.waitForURL(/results/, { timeout: 20000 });
const { value: search } = await until(
  () => page.evaluate(() => ({
    videos: [...document.querySelectorAll("ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model")].filter((n) => n.getClientRects().length > 0).length,
    shorts: [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => a.getClientRects().length > 0 && getComputedStyle(a).visibility !== "hidden").length,
    shortsId: [...document.querySelectorAll('a[href^="/shorts/"]')].map((a) => /^\/shorts\/([\w-]{6,})/.exec(a.getAttribute("href"))?.[1]).find(Boolean) ?? null,
  })),
  (s) => s.videos > 5,
  15000,
  500,
);
await sleep(2000);
const shortsVisible = await page.evaluate(() => [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => a.getClientRects().length > 0 && getComputedStyle(a).visibility !== "hidden").length);
check("search: results rendered (> 5 videos), no visible Shorts links", search.videos > 5 && shortsVisible === 0, { ...search, shortsVisible });
const shortsId = search.shortsId ?? (await page.evaluate(() => [...document.querySelectorAll('a[href^="/shorts/"]')].map((a) => /^\/shorts\/([\w-]{6,})/.exec(a.getAttribute("href"))?.[1]).find(Boolean) ?? null));
check("search: intent pill", await page.locator("#er-pill").isVisible());
await blurPage();
await page.screenshot({ path: join(SHOTS, "2-search.png") });

const first = page.locator('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]').first();
await first.click();
await page.waitForURL(/watch/, { timeout: 20000 });
const watchParts = () => page.evaluate((h) => ({ player: Boolean(document.querySelector(h.player)), related: Boolean(document.querySelector(h.related)), comments: Boolean(document.querySelector(h.comments)), reveal: Boolean(document.getElementById("er-reveal")) }), HEALTH);
const { value: rendered } = await until(watchParts, (r) => r.player && r.related && r.comments && r.reveal, 20000, 500);
check("watch: page rendered (#movie_player, #related, ytd-comments attached)", rendered.player && rendered.related && rendered.comments, rendered);
check("watch: related hidden", rendered.related && !(await visible(HEALTH.related)));
check("watch: reveal button", await page.locator("#er-reveal").isVisible());
check("watch: comments hidden", rendered.comments && !(await visible(HEALTH.comments)));
check("watch: data-er-no-autoplay set (autoplay stop is on)", await page.evaluate(() => document.documentElement.hasAttribute("data-er-no-autoplay")));
await page.screenshot({ path: join(SHOTS, "3-watch.png") });

await page.evaluate(() => {
  const button = document.getElementById("er-reveal");
  window.__reveal = [];
  new MutationObserver(() => {
    const b = document.getElementById("er-reveal");
    const n = Number((b?.textContent || "").match(/\d+/)?.[0]);
    if (b && Number.isFinite(n) && window.__reveal.at(-1)?.n !== n) window.__reveal.push({ t: Date.now(), n, live: b.getAttribute("aria-live") });
  }).observe(button.parentElement, { childList: true, characterData: true, subtree: true, attributes: true });
});
await page.locator("#er-reveal").click();
await sleep(1200);
const revealState = () => page.evaluate(() => {
  const button = document.getElementById("er-reveal");
  return { disabled: button?.getAttribute("aria-disabled") ?? null, text: button?.textContent ?? null, revealed: document.documentElement.hasAttribute("data-er-reveal"), ticks: window.__reveal };
});
const during = await revealState();
await page.locator("#er-reveal").click({ force: true });
await sleep(2500);
const afterSecondClick = await revealState();
const ticks = afterSecondClick.ticks;
const decreasing = ticks.every((x, i) => i === 0 || x.n < ticks[i - 1].n);
check("O1 reveal: a click during the countdown neither reveals nor restarts it", during.disabled === "true" && !during.revealed && !afterSecondClick.revealed && afterSecondClick.disabled === "true" && ticks.length >= 3 && decreasing, { during: { ...during, ticks: undefined }, ticks });
check("O2 reveal: countdown is announced only on the first tick", ticks.length >= 2 && ticks[0].live === "polite" && ticks.slice(1).every((x) => x.live === null), ticks);
await page.screenshot({ path: join(SHOTS, "3b-reveal-countdown.png") });

const playable = await page.evaluate(() => Number.isFinite(document.querySelector("video.html5-main-video")?.duration));
const autoplay = await page.evaluate((sel) => {
  const button = document.querySelector(sel);
  return { button: Boolean(button), checked: button?.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked") ?? null };
}, HEALTH.autoplay);
check("watch: autoplay toggle present and off", playable ? autoplay.button && autoplay.checked === "false" : null, playable ? autoplay : "YouTube did not serve the video to the automated browser; check in Timur's Chrome");
if (playable) {
  await page.evaluate(() => {
    const video = document.querySelector("video.html5-main-video");
    video.muted = true;
    video.currentTime = Math.max(0, video.duration - 2);
    video.play();
  });
  await page.waitForSelector("#er-end", { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const end = await page.evaluate((sel) => {
    const video = document.querySelector("video.html5-main-video");
    const screens = [...document.querySelectorAll(sel)];
    return { reached: Boolean(video) && (video.ended || video.currentTime >= video.duration - 3), endscreen: screens.length, endscreenVisible: screens.some((n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== "hidden" && getComputedStyle(n).display !== "none") };
  }, HEALTH.endscreen);
  await page.screenshot({ path: join(SHOTS, "4-end.png") });
  check("end: prompt visible", end.reached ? await page.locator("#er-end").isVisible() : null, end);
  check("end: endscreen present and hidden", end.reached ? end.endscreen > 0 && !end.endscreenVisible : null, end);
} else {
  check("end: prompt and hidden endscreen", null, "needs playback; check in Timur's Chrome");
}

if (shortsId) {
  const shortsPage = await context.newPage();
  await shortsPage.goto(`https://www.youtube.com/shorts/${shortsId}`, { waitUntil: "domcontentloaded" });
  await shortsPage.waitForURL(/\/watch\?v=/, { timeout: 15000 }).catch(() => {});
  check("shorts: link opens as a normal video", shortsPage.url().includes(`/watch?v=${shortsId}`), shortsPage.url());
  await shortsPage.close();
} else {
  check("shorts: link opens as a normal video", null, "no /shorts/<id> link found on the search page");
}

const popup = await context.newPage();
await popup.setViewportSize({ width: 340, height: 900 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForSelector("#pauseButton", { state: "visible", timeout: 5000 }).catch(() => {});
check("popup: no stats on a fresh profile", await popup.locator("#week").isHidden());
check("popup: pause button shown", await popup.locator("#pauseButton").isVisible());
await popup.screenshot({ path: join(SHOTS, "5-popup.png"), fullPage: true });

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#er-intent", { state: "visible", timeout: 15000 }).catch(() => {});
await popup.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 60_000 }));
const pausedState = () => page.evaluate(() => ({ home: document.documentElement.hasAttribute("data-er-show-home"), shorts: document.documentElement.hasAttribute("data-er-show-shorts"), question: Boolean(document.getElementById("er-intent")?.getClientRects().length) }));
const { value: paused } = await until(pausedState, (s) => s.home && s.shorts && !s.question, 5000, 100);
check("pause: home feed shown", paused.home, paused);
check("pause: question hidden", !paused.question, paused);
check("pause: shorts shown", paused.shorts, paused);
await popup.reload();
const { value: pauseText } = await until(() => popup.locator("#pauseButton").textContent(), (t) => /back|обратно|activar|novo|einschalten/i.test(t), 5000, 100);
check("pause: popup offers resume", /back|обратно|activar|novo|einschalten/i.test(pauseText), pauseText);
await popup.evaluate(() => chrome.storage.local.remove("pausedUntil"));
const { value: resumed } = await until(pausedState, (s) => s.question && !s.home, 5000, 100);
check("resume: question back", resumed.question && !resumed.home, resumed);

await finish(ctx, check);
save("smoke.json");
await context.close();
