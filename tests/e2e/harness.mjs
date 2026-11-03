import { chromium } from "playwright-core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXT = process.env.EXT || new URL("../../dist/chrome", import.meta.url).pathname;
export const OUT = process.env.OUT || new URL("../../.e2e-out/v02", import.meta.url).pathname;
export const QUERY = process.env.QUERY || "swiftui navigation stack tutorial";
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

mkdirSync(OUT, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function reporter() {
  const rows = [];
  const check = (name, ok, detail = "") => {
    const status = ok === null ? "NOT TESTABLE" : ok ? "PASS" : "FAIL";
    rows.push({ name, status, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    console.log(`${status} ${name}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  };
  const save = (file) => writeFileSync(join(OUT, file), JSON.stringify(rows, null, 2));
  return { rows, check, save };
}

export async function launch({ name, locale = "en-US", port = 9339, extension = true, width = 1280, height = 800, ext = EXT, keep = false }) {
  const profile = join(OUT, `profile-${name}`);
  if (!keep) rmSync(profile, { recursive: true, force: true });
  const args = [`--lang=${locale}`, ...(process.env.HEADED === "1" ? ["--window-position=-2000,0"] : ["--headless=new"]), "--disable-blink-features=AutomationControlled", "--use-mock-keychain", "--password-store=basic", `--remote-debugging-port=${port}`];
  if (extension) args.unshift(`--disable-extensions-except=${ext}`, `--load-extension=${ext}`);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: false,
    locale,
    ignoreDefaultArgs: ["--enable-automation"],
    colorScheme: "dark",
    viewport: { width, height },
    args,
  });
  const errors = [];
  const watchPage = (page) => {
    const tag = () => page.url().split("?")[0].slice(0, 80);
    page.on("console", (msg) => {
      if (msg.type() !== "error" && msg.type() !== "warning") return;
      const loc = msg.location()?.url || "";
      if (loc.startsWith("chrome-extension://") || /errand|er-|ErrandLib/i.test(msg.text()) || page.url().startsWith("chrome-extension://")) {
        errors.push({ where: tag(), type: msg.type(), text: msg.text().slice(0, 300), loc });
      }
    });
    page.on("pageerror", (err) => {
      const stack = String(err.stack || err);
      if (stack.includes("chrome-extension://") || page.url().startsWith("chrome-extension://")) errors.push({ where: tag(), type: "pageerror", text: stack.slice(0, 400) });
    });
  };
  context.pages().forEach(watchPage);
  context.on("page", watchPage);
  if (!extension) return { context, errors, port };
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extId = worker.url().split("/")[2];
  const state = { worker };
  const hookWorker = async (w) => {
    w.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") errors.push({ where: "service-worker", type: msg.type(), text: msg.text().slice(0, 300) });
    });
    await w.evaluate(() => {
      globalThis.__errs = globalThis.__errs || [];
      self.addEventListener("error", (e) => globalThis.__errs.push(String(e.message)));
      self.addEventListener("unhandledrejection", (e) => globalThis.__errs.push(String(e.reason?.stack || e.reason)));
    }).catch(() => {});
  };
  await hookWorker(worker);
  context.on("serviceworker", async (w) => {
    if (w.url().includes(extId)) {
      state.worker = w;
      await hookWorker(w);
    }
  });
  return { context, errors, port, extId, state, get worker() { return state.worker; } };
}

export async function consent(page) {
  const reject = page
    .locator('ytd-consent-bump-v2-lightbox button:has-text("Reject"), ytd-consent-bump-v2-lightbox button:has-text("Отклонить"), form button:has-text("Reject all")')
    .first();
  await reject.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await page.waitForTimeout(2500);
  }
}

export async function searchVideoUrls(page, query = QUERY, count = 16) {
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector('a[href^="/watch"]', { timeout: 20000 });
  await page.waitForTimeout(2500);
  return page.evaluate((n) => {
    const seen = new Set();
    for (const a of document.querySelectorAll('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"], ytd-video-renderer a[href^="/watch"]')) {
      const v = new URL(a.href).searchParams.get("v");
      if (v && !a.href.includes("list=")) seen.add(v);
      if (seen.size >= n) break;
    }
    return [...seen].map((v) => `https://www.youtube.com/watch?v=${v}`);
  }, count);
}

async function cdpTargets(port) {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}

class RawPage {
  constructor(ws, target) {
    this.ws = ws;
    this.target = target;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    });
    this.closed = new Promise((r) => ws.addEventListener("close", r));
    ws.addEventListener("close", () => {
      for (const resolve of this.pending.values()) resolve({ result: { closed: true } });
      this.pending.clear();
    });
  }
  send(method, params = {}) {
    if (this.ws.readyState !== 1) return Promise.resolve({ result: { closed: true } });
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  async eval(fnOrExpr, arg) {
    const expression = typeof fnOrExpr === "function" ? `(${fnOrExpr})(${JSON.stringify(arg)})` : fnOrExpr;
    const res = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
    return res.result?.result?.value;
  }
  async click(selector) {
    const box = await this.eval((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, selector);
    if (!box) throw new Error(`no ${selector}`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  }
  async screenshot(path) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(res.result.data, "base64"));
  }
}

export async function openRealPopup(ctx, frontPage) {
  if (frontPage) await frontPage.bringToFront();
  for (const t of await cdpTargets(ctx.port)) if (t.url.includes("/popup.html")) await fetch(`http://127.0.0.1:${ctx.port}/json/close/${t.id}`);
  await sleep(200);
  const r = await ctx.worker.evaluate(async () => {
    try {
      await chrome.action.openPopup();
      return "ok";
    } catch (e) {
      return String(e);
    }
  });
  if (r !== "ok") throw new Error(`openPopup: ${r}`);
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    target = (await cdpTargets(ctx.port)).find((t) => t.url.includes("/popup.html") && t.type === "page");
    if (!target) await sleep(100);
  }
  if (!target) throw new Error("popup target not found");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const page = new RawPage(ws, target);
  await page.send("Runtime.enable");
  page.consoleErrors = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") page.consoleErrors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 300));
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) page.consoleErrors.push(JSON.stringify(msg.params.args).slice(0, 300));
  });
  for (let i = 0; i < 30; i++) {
    if (await page.eval(() => document.readyState === "complete" && document.getElementById("status")?.textContent.length > 0).catch(() => false)) break;
    await sleep(100);
  }
  await sleep(400);
  page.close = async () => {
    await fetch(`http://127.0.0.1:${ctx.port}/json/close/${target.id}`);
    await sleep(300);
  };
  page.isOpen = async () => (await cdpTargets(ctx.port)).some((t) => t.id === target.id);
  return page;
}

export async function storage(ctx, keys = null) {
  return ctx.worker.evaluate((k) => chrome.storage.local.get(k), keys);
}

export async function heap(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  await cdp.detach();
  return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents };
}
