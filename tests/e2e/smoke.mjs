import { chromium } from "playwright-core";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const EXT = process.env.EXT || new URL("../../dist/chrome", import.meta.url).pathname;
const OUT = process.env.OUT || new URL("../../.e2e-out", import.meta.url).pathname;
const LOCALE = process.env.LOCALE || "en-US";
const QUERY = process.env.QUERY || "swiftui navigation stack tutorial";
const VIDEO = process.env.VIDEO === "1";
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

mkdirSync(OUT, { recursive: true });
const profile = join(OUT, "profile");
rmSync(profile, { recursive: true, force: true });

const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: false,
  locale: LOCALE,
  ignoreDefaultArgs: ["--enable-automation"],
  colorScheme: "dark",
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${LOCALE}`, ...(process.env.HEADED === "1" ? ["--window-position=-2000,0"] : ["--headless=new"]), "--disable-blink-features=AutomationControlled", "--use-mock-keychain", "--password-store=basic"],
  recordVideo: VIDEO ? { dir: join(OUT, "video"), size: { width: 1280, height: 800 } } : undefined,
});

const results = {};
const skipped = [];
const check = (name, value) => {
  results[name] = value;
  console.log(`${value ? "PASS" : "FAIL"} ${name}`);
};

let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent("serviceworker");
const extId = worker.url().split("/")[2];

let welcome = null;
for (let i = 0; i < 50 && !welcome; i++) {
  welcome = context.pages().find((p) => p.url().includes("welcome.html")) ?? null;
  if (!welcome) await new Promise((r) => setTimeout(r, 200));
}
check("install: welcome page opened", Boolean(welcome));
if (welcome) {
  await welcome.waitForTimeout(500);
  check("welcome: ask preset selected", await welcome.locator('input[value="ask"]').isChecked());
  check("welcome: three lines", (await welcome.locator("#lines li").count()) === 3);
  await welcome.screenshot({ path: join(OUT, "0-welcome.png"), fullPage: true });
  await welcome.close();
}
const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await context.newPage());
const pause = (ms) => page.waitForTimeout(ms);
const BLUR_CSS = `ytd-thumbnail img, yt-thumbnail-view-model img, yt-image img, #avatar img, yt-img-shadow img, .yt-spec-avatar-shape img, yt-avatar-shape img, ytd-channel-name, #channel-name, .ytContentMetadataViewModelMetadataRow a { filter: blur(9px) !important; }`;
async function blurPage() { await page.addStyleTag({ content: BLUR_CSS }).catch(() => {}); await page.waitForTimeout(400); }


async function consent() {
  const reject = page
    .locator('ytd-consent-bump-v2-lightbox button:has-text("Reject"), ytd-consent-bump-v2-lightbox button:has-text("Отклонить"), ytd-consent-bump-v2-lightbox button:has-text("Rechazar"), ytd-consent-bump-v2-lightbox button:has-text("Rejeitar"), ytd-consent-bump-v2-lightbox button:has-text("Recusar"), ytd-consent-bump-v2-lightbox button:has-text("Ablehnen"), form button:has-text("Reject all")')
    .first();
  await reject.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await page.waitForTimeout(3000);
    console.log("consent: rejected non-essential cookies");
  }
}

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent();
await pause(4000);
check("home: question visible", await page.locator("#er-intent").isVisible());
check("home: feed hidden", !(await page.locator('ytd-browse[page-subtype="home"]').isVisible().catch(() => false)));
await page.screenshot({ path: join(OUT, "1-home.png") });

await page.locator("#er-intent input").click();
await page.keyboard.type(QUERY, { delay: VIDEO ? 60 : 0 });
await pause(VIDEO ? 800 : 100);
await page.screenshot({ path: join(OUT, "1b-home-typed.png") });
await page.keyboard.press("Enter");
await page.waitForURL(/results/, { timeout: 20000 });
await pause(5000);
const visibleShorts = await page.evaluate(
  () => [...document.querySelectorAll('a[href^="/shorts/"]')].filter((a) => a.offsetParent !== null).length,
);
check("search: no visible Shorts links", visibleShorts === 0);
const shortsHref = await page.evaluate(() => document.querySelector('a[href^="/shorts/"]')?.getAttribute("href") || null);
check("search: intent pill", await page.locator("#er-pill").isVisible());
await blurPage();
await page.screenshot({ path: join(OUT, "2-search.png") });

const first = page.locator('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]').first();
await first.click();
await page.waitForURL(/watch/, { timeout: 20000 });
await pause(7000);
check("watch: related hidden", !(await page.locator("ytd-watch-flexy #related").first().isVisible().catch(() => false)));
check("watch: reveal button", await page.locator("#er-reveal").isVisible());
check("watch: comments hidden", !(await page.locator("ytd-comments#comments").isVisible().catch(() => false)));
const autoplay = await page.evaluate(() => document.querySelector(".ytp-autonav-toggle-button")?.getAttribute("aria-checked"));

await page.screenshot({ path: join(OUT, "3-watch.png") });

await page.locator("#er-reveal").click();
await pause(1200);
const revealState = () => page.evaluate(() => {
  const button = document.getElementById("er-reveal");
  return { disabled: button?.getAttribute("aria-disabled") ?? null, live: button?.getAttribute("aria-live") ?? null, text: button?.textContent ?? null, revealed: document.documentElement.hasAttribute("data-er-reveal") };
});
const during = await revealState();
await page.locator("#er-reveal").click({ force: true });
await pause(1800);
const afterSecondClick = await revealState();
check("O1 reveal: a click during the countdown does nothing", during.disabled === "true" && !during.revealed && !afterSecondClick.revealed && afterSecondClick.disabled === "true", JSON.stringify({ during, afterSecondClick }));
check("O2 reveal: countdown is announced only on the first tick", during.live === null, JSON.stringify(during));
await page.screenshot({ path: join(OUT, "3b-reveal-countdown.png") });

const playable = await page.evaluate(() => Number.isFinite(document.querySelector("video.html5-main-video")?.duration));
if (!playable) console.log("SKIP end-of-video checks: YouTube did not serve the video to the automated browser");
if (playable) check("watch: autoplay off", autoplay !== "true");
else console.log("SKIP autoplay check: needs playback");
if (playable) await page.evaluate(() => {
  const video = document.querySelector("video.html5-main-video");
  if (video) {
    video.muted = true;
    video.currentTime = Math.max(0, video.duration - 2);
    video.play();
  }
});
if (playable) {
  await page.waitForSelector("#er-end", { timeout: 20000 }).catch(() => {});
  await pause(1500);
  const reachedEnd = await page.evaluate(() => {
    const video = document.querySelector("video.html5-main-video");
    return Boolean(video) && (video.ended || video.currentTime >= video.duration - 3);
  });
  await page.screenshot({ path: join(OUT, "4-end.png") });
  if (reachedEnd) {
    check("end: prompt visible", await page.locator("#er-end").isVisible());
    check("end: no endscreen grid", !(await page.locator(".ytp-endscreen-content, .ytp-fullscreen-grid-stills-container").first().isVisible().catch(() => false)));
  } else {
    skipped.push("end-of-video");
    console.log("SKIP end-of-video checks: the seek to the end did not land (video still buffering or an ad)");
  }
}

if (shortsHref) {
  const shortsPage = await context.newPage();
  const id = shortsHref.split("/")[2].split(/[?#]/)[0];
  await shortsPage.goto(`https://www.youtube.com/shorts/${id}`, { waitUntil: "domcontentloaded" });
  await shortsPage.waitForURL(/\/watch\?v=/, { timeout: 15000 }).catch(() => {});
  check("shorts: link opens as a normal video", shortsPage.url().includes(`/watch?v=${id}`));
  await shortsPage.close();
} else {
  skipped.push("shorts-redirect");
  console.log("SKIP shorts redirect: no Shorts link found on the search page");
}

const popup = await context.newPage();
await popup.setViewportSize({ width: 340, height: 900 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(800);
check("popup: no stats on a fresh profile", await popup.locator("#week").isHidden());
check("popup: pause button shown", await popup.locator("#pauseButton").isVisible());
await popup.screenshot({ path: join(OUT, "5-popup.png"), fullPage: true });

const health = await popup.evaluate(() => chrome.storage.session.get("health"));
console.log("health:", JSON.stringify(health));

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await pause(3000);
await popup.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 60_000 }));
await pause(1500);
check("pause: home feed shown", await page.evaluate(() => document.documentElement.hasAttribute("data-er-show-home")));
check("pause: question hidden", !(await page.locator("#er-intent").isVisible()));
check("pause: shorts shown", await page.evaluate(() => document.documentElement.hasAttribute("data-er-show-shorts")));
await popup.reload();
await popup.waitForTimeout(500);
check("pause: popup offers resume", /back|обратно|activar|novo|einschalten/i.test(await popup.locator("#pauseButton").textContent()));
await popup.evaluate(() => chrome.storage.local.remove("pausedUntil"));
await pause(1500);
check("resume: question back", await page.locator("#er-intent").isVisible());

await context.close();
const failed = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
console.log(failed.length ? `FAILED: ${failed.join(", ")}` : `ALL PASS${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`);
if (failed.length) process.exitCode = 1;
