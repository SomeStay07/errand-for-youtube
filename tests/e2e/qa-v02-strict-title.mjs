import { launch, reporter, consent, sleep, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-strict-title", port: 9413 });
await sleep(1500);
for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = ctx.context.pages()[0] || (await ctx.context.newPage());
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await sleep(4000);
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
await sleep(2000);
const inside = await dump();
check("inside window: title says strict", /strict/i.test(inside.global), inside);
await sleep(endMs - Date.now() + 65000);
const after = await dump();
const pageStrict = await page.evaluate(() => document.documentElement.hasAttribute("data-er-strict"));
check("65 s after window end: page left strict", !pageStrict);
check("65 s after window end: global title not strict", !/strict/i.test(after.global), after);
await page.locator("#er-intent input").fill(QUERY);
await page.keyboard.press("Enter");
await sleep(9000);
const nav = await dump();
check("after a navigation: global title not strict", !/strict/i.test(nav.global), nav);
check("after a navigation: tab title not strict", nav.tabs.every((t) => !/strict/i.test(t.title)), nav);
await ctx.worker.evaluate(() => chrome.storage.local.set({ intent: null }));
await sleep(1500);
const store = await dump();
check("after any storage.local write (not settings/pause): title not strict", !/strict/i.test(store.global), store);
save("R-strict-title.json");
await ctx.context.close();
