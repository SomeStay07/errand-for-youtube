import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
export const EXT = process.env.EXT || join(ROOT, "dist/chrome");
export const OUT = process.env.OUT || join(ROOT, ".e2e-out/v02");
export const QUERY = process.env.QUERY || "swiftui navigation stack tutorial";
export const CHROME = resolveChrome();

mkdirSync(OUT, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(process.env.HOME, "Library/Caches/ms-playwright");
  const tails = ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"].map((d) => `${d}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`);
  const dirs = (existsSync(base) ? readdirSync(base) : []).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) for (const t of tails) if (existsSync(join(base, d, t))) return join(base, d, t);
  throw new Error(`Chrome for Testing not found under ${base}; set CHROME=<path>`);
}

const DIST_FILES = ["lib.js", "content.js", "background.js", "hide.css", "popup.html", "popup.css", "popup.js", "welcome.html", "welcome.css", "welcome.js", "manifest.json", "_locales"];

function listFiles(dir, rel = "") {
  const full = join(dir, rel);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [rel];
  return readdirSync(full).flatMap((n) => listFiles(dir, rel ? join(rel, n) : n));
}

const fileHash = (path, rel) => {
  const raw = readFileSync(path);
  const body = rel.endsWith(".json") ? JSON.stringify(JSON.parse(raw)) : raw;
  return createHash("sha256").update(body).digest("hex");
};

export function distStale(ext = join(ROOT, "dist/chrome")) {
  const stale = [];
  for (const rel of DIST_FILES.flatMap((f) => listFiles(ROOT, f))) {
    const built = join(ext, rel);
    if (!existsSync(built)) stale.push(`${rel} (missing in dist)`);
    else if (fileHash(join(ROOT, rel), rel) !== fileHash(built, rel)) stale.push(rel);
  }
  return stale;
}

export function sourceHash() {
  const h = createHash("sha256");
  for (const rel of DIST_FILES.flatMap((f) => listFiles(ROOT, f)).sort()) h.update(rel).update(readFileSync(join(ROOT, rel)));
  return h.digest("hex").slice(0, 12);
}

const LANG_LOCK = join(ROOT, ".e2e-out/.lang.lock");
const LANG_WAIT_MS = Number(process.env.LANG_LOCK_WAIT_MS || 600000);
let langLocked = false;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

const writeLang = (locale) => execFileSync("defaults", ["write", "com.google.chrome.for.testing", "AppleLanguages", `("${locale}")`]);
const readLang = () => {
  try {
    return execFileSync("defaults", ["read", "com.google.chrome.for.testing", "AppleLanguages"], { stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
};

function releaseLang() {
  if (!langLocked) return;
  writeLang("en-US");
  rmSync(LANG_LOCK, { force: true });
  langLocked = false;
}

let signalsHooked = false;
function hookSignals() {
  if (signalsHooked) return;
  signalsHooked = true;
  process.on("exit", () => {
    try {
      releaseLang();
    } catch {}
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(sig, () => {
      try {
        releaseLang();
      } catch {}
      process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[sig]);
    });
  }
}

function lockLang() {
  if (langLocked) return;
  mkdirSync(dirname(LANG_LOCK), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      writeFileSync(LANG_LOCK, String(process.pid), { flag: "wx" });
      langLocked = true;
      hookSignals();
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = Number(readFileSync(LANG_LOCK, "utf8").trim());
    if (!holder || !alive(holder)) {
      rmSync(LANG_LOCK, { force: true });
      continue;
    }
    if (Date.now() - start > LANG_WAIT_MS) throw new Error(`AppleLanguages is locked by pid ${holder} (${LANG_LOCK}); locale scripts must run one at a time`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}

export function setLang(locale) {
  lockLang();
  writeLang(locale);
}

export function resetLang() {
  if (!langLocked) return null;
  releaseLang();
  return readLang();
}

function assertEnglishBrowser() {
  if (langLocked) return;
  const start = Date.now();
  for (;;) {
    const holder = existsSync(LANG_LOCK) ? Number(readFileSync(LANG_LOCK, "utf8").trim()) : 0;
    if (!holder || !alive(holder) || holder === process.pid) break;
    if (Date.now() - start > LANG_WAIT_MS) break;
    if (Date.now() - start < 1000) console.log(`waiting for the AppleLanguages lock held by pid ${holder}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  const now = readLang();
  if (now !== null && !/^\(\s*"?en-US"?\s*\)$/.test(now)) {
    const holder = existsSync(LANG_LOCK) ? readFileSync(LANG_LOCK, "utf8").trim() : null;
    throw new Error(`Chrome for Testing AppleLanguages is ${now}, expected en-US${holder ? ` (locale lock held by pid ${holder}: wait for it)` : " (stale: run `defaults write com.google.chrome.for.testing AppleLanguages '(\"en-US\")'`)"}`);
  }
}

export function reporter() {
  const rows = [];
  const check = (name, ok, detail = "") => {
    const status = ok === null ? "NOT TESTABLE" : ok ? "PASS" : "FAIL";
    if (status === "FAIL") process.exitCode = 1;
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    rows.push({ name, status, detail: text });
    console.log(`${status} ${name}${text ? ` — ${text}` : ""}`);
  };
  const save = (file) => writeFileSync(join(OUT, file), JSON.stringify(rows, null, 2));
  process.on("exit", (code) => {
    const n = (s) => rows.filter((r) => r.status === s).length;
    const pass = n("PASS");
    const fail = n("FAIL");
    const nt = n("NOT TESTABLE");
    const allNT = rows.length > 0 && pass === 0 && fail === 0;
    console.log(`RESULT pass=${pass} fail=${fail} nt=${nt}${rows.length === 0 ? " (no checks ran)" : allNT ? " (every check NOT TESTABLE)" : ""}`);
    if (code === 0 && (rows.length === 0 || allNT)) process.exitCode = 1;
  });
  return { rows, check, save };
}

export async function until(probe, pred, ms = 15000, step = 250) {
  const t0 = Date.now();
  let value = await probe();
  while (!pred(value) && Date.now() - t0 < ms) {
    await sleep(step);
    value = await probe();
  }
  return { value, ok: Boolean(pred(value)), ms: Date.now() - t0 };
}

export function messages(locale = "en") {
  const M = JSON.parse(readFileSync(join(ROOT, `_locales/${locale}/messages.json`), "utf8"));
  const msg = (key, value = "") => M[key].message.replace(/\$\w+\$/, value);
  return { M, msg };
}

export async function closeWelcome(ctx, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !ctx.context.pages().some((p) => p.url().includes("welcome.html"))) await sleep(100);
  for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
}

export function settingsApi(ctx) {
  const get = () => ctx.worker.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => globalThis.ErrandLib.mergeSettings(settings)));
  const set = (patch) =>
    ctx.worker.evaluate(
      (p) =>
        chrome.storage.local.get("settings").then(({ settings }) => {
          const s = globalThis.ErrandLib.mergeSettings(settings);
          return chrome.storage.local.set({ settings: { ...s, ...p, hide: { ...s.hide, ...(p.hide || {}) } } });
        }),
      patch,
    );
  const preset = async (name) => set(await ctx.worker.evaluate((n) => globalThis.ErrandLib.applyPreset({}, n), name));
  return { get, set, preset };
}

export async function recheck(ctx) {
  const { get, set } = settingsApi(ctx);
  const { endPrompt } = await get();
  await set({ endPrompt: !endPrompt });
  await sleep(200);
  await set({ endPrompt });
  return Date.now();
}

export async function healthOf(ctx, tabId = null) {
  const { health = {} } = await ctx.worker.evaluate(() => chrome.storage.session.get("health"));
  const [id, entry] = tabId === null ? Object.entries(health).sort((a, b) => b[1].ts - a[1].ts)[0] || [] : [tabId, health[tabId]];
  const tab = id === undefined ? null : Number(id);
  return {
    tab,
    entry: entry ? { ...entry, age: Date.now() - entry.ts } : null,
    badge: tab === null ? null : await ctx.worker.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), tab),
    title: tab === null ? null : await ctx.worker.evaluate((i) => chrome.action.getTitle({ tabId: i }), tab),
  };
}

export const tabIds = (ctx) => ctx.worker.evaluate(() => chrome.tabs.query({}).then((t) => t.map((x) => x.id)));

export async function newTab(ctx) {
  const before = new Set(await tabIds(ctx));
  const page = await ctx.context.newPage();
  const { value } = await until(async () => (await tabIds(ctx)).find((id) => !before.has(id)), (id) => id !== undefined, 3000, 100);
  return { page, tabId: value ?? null };
}

export async function trackHealthCycles(page) {
  await page.addInitScript(() => {
    window.__erCycles = [];
    let last = location.href;
    new MutationObserver((_, obs) => {
      if (!document.getElementById("er-intent")) return;
      window.__erCycles.push({ at: Date.now(), why: "load" });
      last = location.href;
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener("yt-navigate-finish", () => {
      if (location.href === last) return;
      last = location.href;
      window.__erCycles.push({ at: Date.now(), why: "navigate" });
    });
  });
}

export const healthCycles = (page) => page.evaluate(() => window.__erCycles || []);

export async function injectShortsLeak(page) {
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "/shorts/qaLeak12345";
    a.id = "qa-leak";
    a.textContent = "QA leaked Short";
    a.style.cssText = "position:fixed;top:70px;left:10px;z-index:99999;background:#c00;color:#fff;padding:8px";
    document.querySelector("ytd-app").append(a);
  });
}

export async function finish(ctx, check, { extra = [], name = "no extension errors" } = {}) {
  const sw = await ctx.worker?.evaluate(() => globalThis.__errs || []).catch(() => []) ?? [];
  const errors = [...ctx.errors, ...sw, ...extra];
  check(name, errors.length === 0, errors);
  return errors;
}

function devtoolsPort(profile) {
  const file = join(profile, "DevToolsActivePort");
  return existsSync(file) ? Number(readFileSync(file, "utf8").split("\n")[0]) : null;
}

export async function launch({ name, locale = "en-US", extension = true, width = 1280, height = 800, ext = EXT, keep = false, args: extra = [], video = null }) {
  assertEnglishBrowser();
  if (ext === join(ROOT, "dist/chrome") && !process.env.E2E_GATE && !process.env.E2E_ALLOW_STALE) {
    const stale = distStale(ext);
    if (stale.length) throw new Error(`${ext} is older than the sources (${stale.slice(0, 5).join(", ")}${stale.length > 5 ? ", …" : ""}); run npm run build (or E2E_ALLOW_STALE=1)`);
  }
  const profile = join(OUT, `profile-${name}`);
  if (!keep) rmSync(profile, { recursive: true, force: true });
  rmSync(join(profile, "DevToolsActivePort"), { force: true });
  const args = [`--lang=${locale}`, ...(process.env.HEADED === "1" ? ["--window-position=-2000,0"] : ["--headless=new"]), "--disable-blink-features=AutomationControlled", "--use-mock-keychain", "--password-store=basic", "--remote-debugging-port=0", ...extra];
  if (extension) args.unshift(`--disable-extensions-except=${ext}`, `--load-extension=${ext}`);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: false,
    locale,
    ignoreDefaultArgs: ["--enable-automation"],
    colorScheme: "dark",
    viewport: { width, height },
    args,
    ...(video ? { recordVideo: video } : {}),
  });
  let port = null;
  for (let i = 0; i < 50 && !port; i++) {
    port = devtoolsPort(profile);
    if (!port) await sleep(100);
  }
  if (!port) throw new Error(`no DevToolsActivePort in ${profile}`);
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
    .locator(["Reject", "Отклонить", "Rechazar", "Rejeitar", "Recusar", "ablehnen", "すべてを拒否"].flatMap((t) => [`ytd-consent-bump-v2-lightbox button:has-text("${t}")`, `form button:has-text("${t}")`]).join(", "))
    .first();
  await reject.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  if (await reject.isVisible().catch(() => false)) {
    await reject.click();
    await page.waitForTimeout(2500);
  }
}

export async function prefCookie(context, hl, gl = "US") {
  await context.addCookies([{ name: "PREF", value: `hl=${hl}&gl=${gl}`, domain: ".youtube.com", path: "/", secure: true, sameSite: "Lax", expires: Math.floor(Date.now() / 1000) + 86400 }]);
}

export const WATCH_LAYOUT_FLAGS = [
  "enable_web_side_rail",
  "web_watch_split_scroll",
  "swatcheroo_split_scroll",
  "web_watch_fixed_default_panels",
  "web_fixed_panel_watch_next",
  "web_fixed_panel_watch_next_grid_swap",
  "web_side_rail_dismissible_panels",
  "web_side_rail_with_border",
  "web_watch_eligible_to_switch_to_grid",
  "web_watch_enable_single_column_grid_view",
  "web_engagement_panel_show_description",
  "web_watch_move_summary_to_sd",
  "web_watch_hero_list",
  "kevlar_watch_hide_comments_while_panel_open",
  "disable_theater_mode",
];

export const WATCH_GRID_FLAGS = ["kevlar_watch_grid"];

export async function forceWatchLayout(page, flags = WATCH_LAYOUT_FLAGS) {
  await page.addInitScript((names) => {
    const on = Object.fromEntries(names.map((n) => [n, true]));
    const patch = (f) => {
      if (f && typeof f === "object") Object.assign(f, on);
      return f;
    };
    const hooked = new WeakSet();
    const hookCfg = (cfg) => {
      if (!cfg || typeof cfg !== "object" || hooked.has(cfg)) return;
      hooked.add(cfg);
      let v = patch(cfg.EXPERIMENT_FLAGS);
      try {
        Object.defineProperty(cfg, "EXPERIMENT_FLAGS", { configurable: true, enumerable: true, get: () => v, set: (n) => (v = patch(n)) });
      } catch {}
    };
    const hookProp = (obj, name, onValue) => {
      let v = obj[name];
      if (v) onValue(v);
      try {
        Object.defineProperty(obj, name, {
          configurable: true,
          enumerable: true,
          get: () => v,
          set: (n) => {
            v = n;
            if (n) onValue(n);
          },
        });
      } catch {}
    };
    hookProp(window, "yt", (y) => hookProp(y, "config_", hookCfg));
    hookProp(window, "ytcfg", (c) => hookProp(c, "data_", hookCfg));
  }, flags);
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
