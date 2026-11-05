import { launch, reporter, consent, sleep, until, closeWelcome, finish, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-strict-title" });
await closeWelcome(ctx);
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("#er-intent", { state: "visible", timeout: 15000 });
const hhmm = (ms) => {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};
let now = Date.now();
if (new Date(now).getSeconds() > 45) {
  await sleep((61 - new Date(now).getSeconds()) * 1000);
  now = Date.now();
}
const endMs = new Date(now + 60e3).setSeconds(0, 0);
const DEFAULTS = await ctx.worker.evaluate(() => globalThis.ErrandLib.DEFAULTS);
await ctx.worker.evaluate((s) => chrome.storage.local.set({ settings: s }), { ...DEFAULTS, mode: "auto", strictStart: hhmm(now - 60e3), strictEnd: hhmm(now + 60e3), strictDays: [0, 1, 2, 3, 4, 5, 6] });
const dump = () => ctx.worker.evaluate(async () => {
  const tabs = await chrome.tabs.query({});
  const { health = {} } = await chrome.storage.session.get("health");
  const out = { global: await chrome.action.getTitle({}), tabs: [] };
  for (const t of tabs) out.tabs.push({ id: t.id, url: (t.url || t.pendingUrl || "?").slice(0, 60), title: await chrome.action.getTitle({ tabId: t.id }), badge: await chrome.action.getBadgeText({ tabId: t.id }), health: health[t.id] ?? null });
  return out;
});
const strictAttr = () => page.evaluate(() => document.documentElement.hasAttribute("data-er-strict"));
const { value: pageWasStrict } = await until(strictAttr, Boolean, 5000, 100);
const { value: inside } = await until(dump, (d) => /strict/i.test(d.global), 5000, 200);
check("inside window: page is strict and the title says strict", pageWasStrict && /strict/i.test(inside.global), { pageWasStrict, inside });
await sleep(Math.max(0, endMs - Date.now()));
const { value: pageStrict, ms: leftAfter } = await until(strictAttr, (v) => !v, 75000, 500);
const after = await dump();
check("within 75 s after window end: page left strict", pageWasStrict && !pageStrict, { leftAfterMs: leftAfter });
check("after the page left strict: global title not strict", !/strict/i.test(after.global), after);
await page.locator("#er-intent input").fill(QUERY);
await page.keyboard.press("Enter");
await page.waitForURL(/results/, { timeout: 15000 }).catch(() => {});
const { value: nav } = await until(dump, (d) => d.tabs.some((t) => t.health), 20000, 500);
check("after a navigation: global title not strict", !/strict/i.test(nav.global), nav);
check("after a navigation: tab title not strict", nav.tabs.every((t) => !/strict/i.test(t.title)), nav);
await ctx.worker.evaluate(() => chrome.storage.local.set({ intent: null }));
const { value: store } = await until(dump, (d) => !/strict/i.test(d.global), 3000, 200);
check("after any storage.local write (not settings/pause): title not strict", !/strict/i.test(store.global), store);
await finish(ctx, check);
save("R-strict-title.json");
await ctx.context.close();
