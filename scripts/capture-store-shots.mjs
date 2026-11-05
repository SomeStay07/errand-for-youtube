import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consent, sleep, setLang, resetLang } from "/Users/timurceberda/Developer/errand-for-youtube/tests/e2e/harness.mjs";
import { chromium } from "/Users/timurceberda/Developer/errand-for-youtube/node_modules/playwright-core/index.mjs";
import { rmSync } from "node:fs";
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const EXT = "/Users/timurceberda/Developer/errand-for-youtube/dist/chrome";
async function launch({ name, locale, port, width, height }) {
  const profile = join(OUTDIR, `profile-${name}`);
  rmSync(profile, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME, headless: false, locale, ignoreDefaultArgs: ["--enable-automation"], colorScheme: "dark", viewport: { width, height },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${locale}`, "--headless=new", "--disable-blink-features=AutomationControlled", "--use-mock-keychain", "--password-store=basic", "--no-sandbox", "--enable-features=NetworkServiceInProcess", `--remote-debugging-port=${port}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return { context, worker, extId: worker.url().split("/")[2], errors: [] };
}

const ROOT = "/Users/timurceberda/Developer/errand-for-youtube";
const OUTDIR = process.env.SHOTS_OUT;
const QUERY = "swiftui navigation stack tutorial";
const LOCALES = (process.env.LOCALES || "en-US:en,ru-RU:ru,es-ES:es,pt-BR:pt_BR,de-DE:de").split(",").map((s) => s.split(":"));

const BLUR = `
  ytd-thumbnail, yt-thumbnail-view-model, .ytThumbnailViewModelImage, ytd-video-renderer img, yt-lockup-view-model img,
  #channel-thumbnail, #avatar, yt-img-shadow, .yt-spec-avatar-shape, yt-avatar-shape, yt-decorated-avatar-view-model,
  ytd-channel-name, #channel-name, #channel-info ytd-channel-name, .yt-content-metadata-view-model-wiz__metadata-text a,
  ytd-expandable-metadata-renderer #thumbnail, ytd-expandable-metadata-renderer img
  { filter: blur(12px) !important; }
`;

const report = [];

try {
  for (const [lang, dir] of LOCALES) {
    setLang(lang);
    const out = join(OUTDIR, dir);
    mkdirSync(out, { recursive: true });
    const ctx = await launch({ name: `store-${dir}`, locale: lang, port: 9351, width: 1280, height: 800 });
    await sleep(1500);
    for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close().catch(() => {});
    await ctx.context.addCookies([{ name: "PREF", value: "f6=400", domain: ".youtube.com", path: "/", secure: true }]);
    const page = await ctx.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
    await consent(page);
    const reject = page.locator('ytd-consent-bump-v2-lightbox button:has-text("Rechazar todo"), ytd-consent-bump-v2-lightbox button:has-text("Rejeitar"), ytd-consent-bump-v2-lightbox button:has-text("Recusar"), ytd-consent-bump-v2-lightbox button:has-text("Alle ablehnen")').first();
    if (await reject.isVisible().catch(() => false)) {
      await reject.click();
      await sleep(2500);
    }
    if (await page.locator("ytd-consent-bump-v2-lightbox button").first().isVisible().catch(() => false)) throw new Error(`consent still visible ${dir}`);
    await page.waitForSelector("#er-intent input", { timeout: 20000 });
    await sleep(2500);
    await page.locator("#er-intent input").fill(QUERY);
    await page.mouse.move(1, 790);
    await sleep(500);
    await page.screenshot({ path: join(out, "home.png") });
    const homeText = await page.locator("#er-intent").innerText();
    await page.locator("#er-intent input").press("Enter");
    await page.waitForURL(/results/, { timeout: 30000, waitUntil: "commit" });
    await page.waitForSelector("ytd-video-renderer, yt-lockup-view-model", { timeout: 20000 });
    await sleep(4000);
    await page.addStyleTag({ content: BLUR });
    await page.mouse.move(1, 790);
    await sleep(1500);
    await page.screenshot({ path: join(out, "search.png") });
    await page.setViewportSize({ width: 1520, height: 784 });
    await sleep(2000);
    if (await page.evaluate(() => document.querySelector("ytd-app")?.hasAttribute("guide-persistent-and-visible"))) {
      await page.locator("#guide-button").first().click();
      await page.mouse.move(1, 790);
      await sleep(1500);
    }
    const bg = await page.screenshot({ type: "png" });
    const ytTabHealth = await ctx.worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
      const { health = {} } = await chrome.storage.session.get("health");
      return tabs.map((tb) => health[tb.id] || null).find(Boolean) || null;
    });

    const popup = await ctx.context.newPage();
    await popup.setViewportSize({ width: 340, height: 1000 });
    await popup.goto(`chrome-extension://${ctx.extId}/popup.html`);
    await sleep(500);
    if (ytTabHealth) {
      await popup.evaluate(async (entry) => {
        const tab = await chrome.tabs.getCurrent();
        const { health = {} } = await chrome.storage.session.get("health");
        await chrome.storage.session.set({ health: { ...health, [tab.id]: entry } });
      }, ytTabHealth);
      await popup.reload();
    }
    await sleep(800);
    const info = await popup.evaluate(() => ({
      w: Math.ceil(document.body.getBoundingClientRect().width),
      h: Math.ceil(document.body.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).marginBottom || 0)),
      status: document.getElementById("status").textContent,
      health: document.getElementById("health").hidden ? null : document.getElementById("health").textContent,
      week: !document.getElementById("week").hidden,
      text: document.body.innerText,
    }));
    await popup.setViewportSize({ width: info.w, height: info.h });
    await sleep(300);
    const pop = await popup.screenshot({ type: "png" });
    await popup.close();

    const comp = await ctx.context.newPage();
    await comp.setViewportSize({ width: 1520, height: 784 });
    const ph = Math.min(info.h, 784 - 22 - 8);
    await comp.setContent(`<!doctype html><html><body style="margin:0;width:1520px;height:784px;overflow:hidden;position:relative;background:#000">
      <img src="data:image/png;base64,${bg.toString("base64")}" style="position:absolute;left:0;top:0;width:1520px;height:784px">
      <div style="position:absolute;left:${1520 - 40 - info.w}px;top:22px;width:${info.w}px;height:${ph}px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,0.12),0 12px 40px rgba(0,0,0,0.6)">
        <img src="data:image/png;base64,${pop.toString("base64")}" style="display:block;width:${info.w}px">
      </div></body></html>`);
    await sleep(500);
    await comp.screenshot({ path: join(out, "popup.png") });
    await comp.close();
    report.push({ dir, ui: lang, homeText, health: ytTabHealth, popup: info, errors: ctx.errors });
    await ctx.context.close();
  }
} finally {
  console.log("AppleLanguages reset:", resetLang());
  writeFileSync(join(OUTDIR, "report.json"), JSON.stringify(report, null, 2));
}
