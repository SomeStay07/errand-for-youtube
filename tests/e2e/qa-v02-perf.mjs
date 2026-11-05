import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, consent, sleep, OUT, QUERY } from "./harness.mjs";

const ARM = process.env.ARM || "ext";
const IDLE_S = Number(process.env.IDLE_S || 300);
const CHURN = Number(process.env.CHURN || 60);
const PAGES = (process.env.PAGES || "home,search,subs,watch").split(",");
const PORT = ARM === "ext" ? 9371 : 9372;
const ctx = await launch({ name: `perf-${ARM}`, port: PORT, extension: ARM === "ext" });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
await cdp.send("HeapProfiler.enable");

async function metrics(gc = false) {
  if (gc) await cdp.send("HeapProfiler.collectGarbage");
  const { metrics: list } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(list.map((x) => [x.name, x.value]));
  return {
    t: Date.now(),
    task: m.TaskDuration,
    script: m.ScriptDuration,
    style: m.RecalcStyleDuration,
    styleCount: m.RecalcStyleCount,
    layout: m.LayoutDuration,
    heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2),
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
  };
}

const cpu = (a, b) => +(((b.task - a.task) / ((b.t - a.t) / 1000)) * 100).toFixed(3);

async function trace(run) {
  const events = [];
  const onData = (e) => events.push(...e.value);
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel", "v8.execute"] },
    transferMode: "ReportEvents",
  });
  await run();
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", onData);
  const started = events.find((e) => e.name === "TracingStartedInBrowser");
  const framePid = started?.args?.data?.frames?.find((f) => !f.parent)?.processId;
  const mains = events.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  const busy = (m) => events.filter((x) => x.pid === m.pid && x.tid === m.tid && x.name === "RunTask").length;
  const main = mains.find((m) => m.pid === framePid) || mains.sort((a, b) => busy(b) - busy(a))[0];
  const onMain = main ? events.filter((e) => e.pid === main.pid && e.tid === main.tid) : [];
  const tasks = onMain.filter((e) => e.name === "RunTask" && e.ph === "X");
  const long = tasks.filter((e) => e.dur > 50000);
  const ext = onMain.filter((e) => ["FunctionCall", "EvaluateScript", "TimerFire", "EventDispatch"].includes(e.name) && JSON.stringify(e.args || {}).includes("chrome-extension://"));
  const longExt = long.filter((lt) => ext.some((x) => x.ts >= lt.ts && x.ts <= lt.ts + lt.dur && x.dur > 5000));
  const styles = onMain.filter((e) => (e.name === "UpdateLayoutTree" || e.name === "RecalculateStyles") && e.ph === "X");
  return {
    events: events.length,
    longTasks: long.length,
    longTaskMaxMs: +(Math.max(0, ...long.map((e) => e.dur)) / 1000).toFixed(1),
    longTasksWithExtensionJs: longExt.length,
    extensionJsMs: +(ext.reduce((s, e) => s + (e.dur || 0), 0) / 1000).toFixed(1),
    extensionJsCalls: ext.length,
    styleMs: +(styles.reduce((s, e) => s + (e.dur || 0), 0) / 1000).toFixed(1),
    styleOver50: styles.filter((e) => e.dur > 50000).length,
    styleMaxMs: +(Math.max(0, ...styles.map((e) => e.dur)) / 1000).toFixed(1),
  };
}

const URLS = {
  home: "https://www.youtube.com/",
  search: `https://www.youtube.com/results?search_query=${encodeURIComponent(QUERY)}`,
  subs: "https://www.youtube.com/feed/subscriptions",
};

async function watchUrl() {
  await page.goto(URLS.search, { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector('ytd-video-renderer a#thumbnail[href^="/watch"]', { timeout: 20000 });
  return page.evaluate(() => document.querySelector('ytd-video-renderer a#thumbnail[href^="/watch"]').href.split("&")[0]);
}

const result = { arm: ARM, idleSeconds: IDLE_S, chrome: (await page.evaluate(() => navigator.userAgent)), pages: {} };
URLS.watch = await watchUrl();

for (const name of PAGES) {
  await page.goto(URLS[name], { waitUntil: "domcontentloaded" });
  await consent(page);
  await sleep(10000);
  const start = await metrics(true);
  const samples = [];
  let prev = start;
  const t0 = Date.now();
  while (Date.now() - t0 < IDLE_S * 1000) {
    await sleep(30000);
    const m = await metrics(false);
    samples.push({ s: Math.round((m.t - t0) / 1000), cpu: cpu(prev, m), heapMB: m.heapMB, nodes: m.nodes, listeners: m.listeners });
    prev = m;
  }
  const end = await metrics(true);
  const idle = {
    cpuPct: cpu(start, end),
    styleMsPerMin: +(((end.style - start.style) * 1000) / ((end.t - start.t) / 60000)).toFixed(1),
    scriptMsPerMin: +(((end.script - start.script) * 1000) / ((end.t - start.t) / 60000)).toFixed(1),
    start: { heapMB: start.heapMB, nodes: start.nodes, listeners: start.listeners },
    end: { heapMB: end.heapMB, nodes: end.nodes, listeners: end.listeners },
    samples,
  };
  const idleTrace = await trace(() => sleep(20000));
  let scroll = null;
  if (name !== "watch") {
    await page.mouse.move(640, 500);
    const before = await metrics(false);
    const tr = await trace(async () => {
      const t1 = Date.now();
      while (Date.now() - t1 < 20000) {
        await page.mouse.wheel(0, 400);
        await sleep(200);
      }
    });
    const after = await metrics(false);
    scroll = { ...tr, styleMsMetric: +((after.style - before.style) * 1000).toFixed(1), styleCount: after.styleCount - before.styleCount, cpuPct: cpu(before, after), nodesAfter: after.nodes };
  }
  result.pages[name] = { url: page.url(), idle, idleTrace, scroll };
  console.log(name, JSON.stringify({ cpu: idle.cpuPct, start: idle.start, end: idle.end, idleTrace, scroll }));
}

async function churn(n) {
  await page.goto(URLS.search, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await consent(page);
  const base = await metrics(true);
  const marks = [];
  const problems = [];
  const t0 = Date.now();
  let navs = 0;
  for (let i = 0; i < n; i++) {
    const links = page.locator('ytd-video-renderer a#thumbnail[href^="/watch"]');
    const count = await links.count();
    if (!count) {
      problems.push(`round ${i}: no results`);
      await page.goto(URLS.search, { waitUntil: "domcontentloaded" });
      await sleep(4000);
      continue;
    }
    const link = links.nth(i % Math.min(count, 12));
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click({ timeout: 8000 }).catch((e) => problems.push(`round ${i}: ${String(e).slice(0, 60)}`));
    await page.waitForURL(/watch/, { timeout: 15000 }).catch(() => problems.push(`round ${i}: no watch`));
    navs++;
    await sleep(1500);
    if (i % 5 === 4) {
      await page.locator("a#logo, ytd-topbar-logo-renderer a").first().click({ timeout: 8000 }).catch(() => problems.push(`round ${i}: logo`));
      await page.waitForURL((u) => ["/", "/feed/subscriptions"].includes(new URL(u).pathname), { timeout: 10000 }).catch(() => {});
      navs++;
      await sleep(1500);
      const sub = page.locator('ytd-mini-guide-entry-renderer a[href="/feed/subscriptions"], ytd-guide-entry-renderer a[href="/feed/subscriptions"]').first();
      if (await sub.isVisible().catch(() => false)) {
        await sub.click({ timeout: 5000 }).catch(() => {});
        navs++;
        await sleep(1500);
      }
      const box = page.locator('[name="search_query"]').first();
      await box.click({ timeout: 5000 }).catch(() => {});
      await box.fill(QUERY).catch(() => {});
      await box.press("Enter").catch(() => {});
      await page.waitForURL(/results/, { timeout: 15000 }).catch(() => problems.push(`round ${i}: masthead search`));
      navs++;
      await sleep(2500);
    } else {
      await page.goBack();
      await page.waitForURL(/results/, { timeout: 15000 }).catch(() => problems.push(`round ${i}: back`));
      navs++;
      await sleep(1200);
    }
    if (i % 10 === 9) {
      const m = await metrics(true);
      marks.push({ round: i + 1, navs, heapMB: m.heapMB, nodes: m.nodes, listeners: m.listeners, cpuPct: cpu(base, m), erNodes: await page.evaluate(() => document.querySelectorAll('[id^="er-"]').length) });
    }
  }
  const end = await metrics(true);
  return { navs, seconds: Math.round((Date.now() - t0) / 1000), base: { heapMB: base.heapMB, nodes: base.nodes, listeners: base.listeners }, marks, end: { heapMB: end.heapMB, nodes: end.nodes, listeners: end.listeners }, cpuPct: cpu(base, end), problems };
}

if (CHURN > 0) {
  result.churn = await churn(CHURN);
  console.log("churn", JSON.stringify(result.churn));
}
if (ARM === "ext") result.swErrors = await ctx.worker.evaluate(() => globalThis.__errs || []).catch((e) => [String(e)]);
result.extErrors = ctx.errors;
writeFileSync(join(OUT, `perf-${ARM}.json`), JSON.stringify(result, null, 2));
await context.close();
