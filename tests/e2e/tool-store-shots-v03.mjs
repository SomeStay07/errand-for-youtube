import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, consent, sleep, setLang, resetLang } from "./harness.mjs";

const OUTDIR = process.env.SHOTS_OUT;
if (!OUTDIR) throw new Error("set SHOTS_OUT");
const QUERY = process.env.QUERY || "swiftui navigation stack tutorial";
const WATCH = process.env.WATCH || "";
const BLUR_THUMBS = (process.env.BLUR_THUMBS || "").split(",").filter(Boolean);
const NO_BLUR = process.env.NO_BLUR === "1";
const LOCALES = (process.env.LOCALES || "en-US:en:en:US,ru-RU:ru:ru:RU,es-ES:es:es:ES,pt-BR:pt_BR:pt:BR,de-DE:de:de:DE").split(",").map((s) => s.split(":"));
const ONLY = new Set((process.env.STEPS || "welcome,home,search,watch,popup").split(","));
const PARK = [1275, 795];
const POPUP_H = Object.fromEntries((process.env.POPUP_H || "").split(",").filter(Boolean).map((s) => s.split(":")));

const BLUR = `
  #channel-thumbnail, #avatar, #owner #avatar, yt-img-shadow#avatar, .yt-spec-avatar-shape, yt-avatar-shape, yt-decorated-avatar-view-model,
  ytd-channel-name, #channel-name, #owner ytd-channel-name, #owner-sub-count, .yt-content-metadata-view-model-wiz__metadata-text a,
  ytd-video-owner-renderer #avatar, #avatar-btn, ytd-topbar-menu-button-renderer img,
  ytd-video-renderer [class*="metadata-snippet-container"], #page-manager a[href^="/@"], #page-manager a[href^="/channel/"], #page-manager a[href^="/c/"], #page-manager a[href^="/user/"]
  { filter: blur(8px) !important; }
  html { scrollbar-width: none; }
`;

const CHROME_BRANDS = { brands: [{ brand: "Google Chrome", version: "151" }, { brand: "Chromium", version: "151" }, { brand: "Not/A)Brand", version: "24" }], platform: "macOS", platformVersion: "15.0.0", architecture: "arm", model: "", mobile: false };

const blurThumbs = (page, ids) =>
  page.evaluate((list) => {
    for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
      const v = new URL(a.href).searchParams.get("v");
      if (!list.includes(v)) continue;
      const box = a.closest("ytd-video-renderer, yt-lockup-view-model, ytd-rich-item-renderer") || a;
      for (const img of box.querySelectorAll("ytd-thumbnail, yt-thumbnail-view-model, img")) img.style.setProperty("filter", "blur(8px)", "important");
    }
  }, ids);

const report = [];

try {
  for (const [lang, dir, hl, gl] of LOCALES) {
    setLang(lang);
    const out = join(OUTDIR, dir);
    mkdirSync(out, { recursive: true });
    const ctx = await launch({ name: `store03-${dir}`, locale: lang });
    const row = { dir, lang };
    let welcome;
    for (let i = 0; i < 30 && !welcome; i++) {
      welcome = ctx.context.pages().find((p) => p.url().includes("welcome.html"));
      if (!welcome) await sleep(200);
    }
    if (ONLY.has("welcome") && welcome) {
      const cdp = await ctx.context.newCDPSession(welcome);
      const ua = await welcome.evaluate(() => navigator.userAgent);
      await cdp.send("Emulation.setUserAgentOverride", { userAgent: ua.replace(/HeadlessChrome/, "Chrome"), userAgentMetadata: CHROME_BRANDS });
      await welcome.setViewportSize({ width: 1024, height: 640 });
      await welcome.reload();
      await welcome.waitForLoadState("load");
      await sleep(800);
      await welcome.addStyleTag({ content: "html { scrollbar-width: none; }" });
      await welcome.locator('input[name="preset"][value="shorts"]').check();
      await welcome.evaluate(() => document.activeElement?.blur());
      await sleep(800);
      await welcome.mouse.move(1020, 636);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 640, deviceScaleFactor: 1.25, mobile: false });
      await sleep(500);
      const bottom = await welcome.evaluate(() => Math.ceil(document.getElementById("lines").getBoundingClientRect().bottom));
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1024, height: bottom + 14, scale: 1 } });
      writeFileSync(join(out, "welcome-shorts.png"), Buffer.from(data, "base64"));
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      row.welcome = await welcome.evaluate(() => ({ text: document.body.innerText, h: document.documentElement.scrollHeight }));
      await welcome.locator('input[name="preset"][value="ask"]').check();
      await sleep(600);
    }
    if (welcome) await welcome.close().catch(() => {});
    if (![...ONLY].some((x) => x !== "welcome")) {
      report.push(row);
      await ctx.context.close();
      continue;
    }

    await ctx.context.addCookies([{ name: "PREF", value: `f6=400&hl=${hl}&gl=${gl}`, domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 86400 }]);
    const page = await ctx.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
    await consent(page);
    await page.waitForSelector("#er-intent input", { timeout: 20000 });
    await sleep(2500);
    await page.locator("#er-intent input").fill(QUERY);
    await page.mouse.move(...PARK);
    await sleep(500);
    if (!NO_BLUR) await page.addStyleTag({ content: BLUR });
    if (ONLY.has("home")) await page.screenshot({ path: join(out, "home.png") });
    row.home = await page.locator("#er-intent").innerText();
    await page.locator("#er-intent input").press("Enter");
    await page.waitForURL(/results/, { timeout: 30000, waitUntil: "commit" });
    await page.waitForSelector("ytd-video-renderer, yt-lockup-view-model", { timeout: 20000 });
    await sleep(4000);
    if (!NO_BLUR) {
      await page.addStyleTag({ content: BLUR });
      await blurThumbs(page, BLUR_THUMBS);
    }
    await page.mouse.move(...PARK);
    await sleep(1500);
    row.pill = await page.evaluate(() => {
      const p = document.getElementById("er-pill");
      return p ? { text: p.innerText, rect: p.getBoundingClientRect().toJSON() } : null;
    });
    row.ads = await page.evaluate(() => document.querySelectorAll("ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-in-feed-ad-layout-renderer").length);
    row.results = await page.evaluate(() =>
      [...document.querySelectorAll("ytd-video-renderer")].slice(0, 6).map((r) => ({
        v: new URL(r.querySelector("a#thumbnail")?.href || location.href).searchParams.get("v"),
        title: r.querySelector("#video-title")?.textContent.trim(),
        top: Math.round(r.getBoundingClientRect().top),
      })),
    );
    if (ONLY.has("search")) {
      await page.setViewportSize({ width: 1280, height: 740 });
      await sleep(1500);
      await page.screenshot({ path: join(out, "search.png") });
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    if (ONLY.has("popup")) {
      const PH = Number(POPUP_H[dir] || 784);
      await page.setViewportSize({ width: 1520, height: PH });
      await sleep(2000);
      if (await page.evaluate(() => document.querySelector("ytd-app")?.hasAttribute("guide-persistent-and-visible"))) {
        await page.locator("#guide-button").first().click();
        await sleep(1500);
      }
      await page.mouse.move(1000, PH - 1);
      await sleep(800);
      const bg = await page.screenshot({ type: "png" });
      const popup = await ctx.context.newPage();
      await popup.setViewportSize({ width: 340, height: 1000 });
      await popup.goto(`chrome-extension://${ctx.extId}/popup.html`);
      await sleep(1200);
      const info = await popup.evaluate(() => ({
        w: Math.ceil(document.body.getBoundingClientRect().width),
        h: Math.ceil(document.body.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).marginBottom || 0)),
        status: document.getElementById("status").textContent,
      }));
      await popup.setViewportSize({ width: info.w, height: info.h });
      await sleep(300);
      const pop = await popup.screenshot({ type: "png" });
      await popup.close();
      const comp = await ctx.context.newPage();
      await comp.setViewportSize({ width: 1520, height: PH });
      const ph = Math.min(info.h, PH - 22 - 8);
      await comp.setContent(`<!doctype html><html><body style="margin:0;width:1520px;height:${PH}px;overflow:hidden;position:relative;background:#000">
        <img src="data:image/png;base64,${bg.toString("base64")}" style="position:absolute;left:0;top:0;width:1520px;height:${PH}px">
        <div style="position:absolute;left:${1520 - 40 - info.w}px;top:22px;width:${info.w}px;height:${ph}px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,0.12),0 12px 40px rgba(0,0,0,0.6)">
          <img src="data:image/png;base64,${pop.toString("base64")}" style="display:block;width:${info.w}px">
        </div></body></html>`);
      await sleep(500);
      await comp.screenshot({ path: join(out, "popup.png") });
      await comp.close();
      row.popup = info;
      await page.setViewportSize({ width: 1280, height: 800 });
      await sleep(1000);
    }

    if (ONLY.has("watch")) {
      const id = WATCH || row.results.find((r) => r.v)?.v;
      await page.locator(`ytd-video-renderer a#thumbnail[href*="${id}"]`).first().click().catch(() => page.goto(`https://www.youtube.com/watch?v=${id}`));
      await page.waitForURL(/watch/, { timeout: 30000 });
      await sleep(6000);
      if (!NO_BLUR) await page.addStyleTag({ content: BLUR }).catch(() => {});
      await page.evaluate(() => document.querySelector("video")?.pause()).catch(() => {});
      await page.mouse.move(...PARK);
      await sleep(1000);
      row.watch = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON() || null;
        const v = document.querySelector("video");
        return {
          id: new URL(location.href).searchParams.get("v"),
          reveal: r("#er-reveal"),
          comments: r("#er-comments"),
          pill: r("#er-pill"),
          video: v ? { duration: v.duration, readyState: v.readyState, src: !!v.currentSrc } : null,
          playerError: document.querySelector(".ytp-error, yt-playability-error-supported-renderers")?.innerText?.slice(0, 200) || null,
        };
      });
      await page.screenshot({ path: join(out, "watch.png") });
    }
    row.errors = ctx.errors;
    report.push(row);
    await ctx.context.close();
  }
} finally {
  console.log("AppleLanguages reset:", resetLang());
  writeFileSync(join(OUTDIR, "report.json"), JSON.stringify(report, null, 2));
}
