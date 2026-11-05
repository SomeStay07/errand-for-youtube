import { join } from "node:path";
import { launch, reporter, consent, sleep, prefCookie, OUT } from "./harness.mjs";

const { check, save } = reporter();
const LANGS = (process.env.HLS || "ja,de,en").split(",");
const SHORTS = { ja: "ショート", de: "Shorts", en: "Shorts" };
const ctx = await launch({ name: "v03-locale-shorts", port: 9372 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
const W = ctx.worker;
const setShorts = (mode) => W.evaluate((m) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.mergeSettings(settings), shortsMode: m } })), mode);
const badge = async () => {
  const { health = {} } = await W.evaluate(() => chrome.storage.session.get("health"));
  const [id, entry] = Object.entries(health).sort((a, b) => b[1].ts - a[1].ts)[0] || [];
  return { entry, badge: id ? await W.evaluate((i) => chrome.action.getBadgeText({ tabId: i }), Number(id)) : null };
};
const scan = (label) =>
  page.evaluate((label) => {
    const h = (n) => Math.round(n.getBoundingClientRect().height);
    const tabs = [...document.querySelectorAll("yt-tab-shape")].map((n) => ({ title: n.getAttribute("tab-title"), h: h(n) }));
    const chips = [...document.querySelectorAll("yt-chip-cloud-chip-renderer")].map((n) => ({ title: n.textContent.trim(), h: h(n) }));
    const guide = document.querySelector('ytd-guide-entry-renderer a[href^="/shorts"], ytd-mini-guide-entry-renderer a[href^="/shorts"]');
    return {
      hl: document.documentElement.lang,
      guideLabel: guide?.getAttribute("title") || guide?.textContent?.trim() || null,
      shortsTab: tabs.filter((t) => t.title === label),
      otherTabs: tabs.filter((t) => t.title !== label && t.h > 0).length,
      shortsChip: chips.filter((c) => c.title === label),
      otherChips: chips.filter((c) => c.title !== label && c.h > 0).length,
    };
  }, label);

for (const hl of LANGS) {
  const label = SHORTS[hl] || "Shorts";
  await context.clearCookies();
  await prefCookie(context, hl);
  await page.goto("https://www.youtube.com/@MKBHD", { waitUntil: "domcontentloaded" });
  await consent(page);
  await page.waitForSelector("yt-tab-shape", { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  const ch = await scan(label);
  await page.screenshot({ path: join(OUT, `L-${hl}-channel.png`) });
  check(`F5 ${hl} channel: Shorts tab "${label}" height 0 within 3 s, other tabs visible`, ch.shortsTab.length > 0 && ch.shortsTab.every((t) => t.h === 0) && ch.otherTabs >= 2, ch);
  await page.goto("https://www.youtube.com/@MKBHD/videos", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("yt-tab-shape", { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  const chv = await scan(label);
  check(`F5 ${hl} channel Videos tab: Shorts tab hidden, other tabs visible`, chv.shortsTab.length > 0 && chv.shortsTab.every((t) => t.h === 0) && chv.otherTabs >= 2, chv);
  await page.goto("https://www.youtube.com/results?search_query=minecraft", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("yt-chip-cloud-chip-renderer", { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  const se = await scan(label);
  await page.screenshot({ path: join(OUT, `L-${hl}-search.png`) });
  check(`F5 ${hl} search: Shorts chip "${label}" height 0, other chips visible`, se.shortsChip.length > 0 && se.shortsChip.every((c) => c.h === 0) && se.otherChips >= 2, se);
  await sleep(Math.max(0, 14000 - 3000));
  const hs = await badge();
  check(`F5 ${hl}: no '!' on these pages`, hs.badge !== "!" && hs.entry?.missing.length === 0, hs);
  if (hl === "ja") {
    await setShorts("show");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("yt-chip-cloud-chip-renderer", { timeout: 20000 }).catch(() => {});
    await sleep(3000);
    const showSearch = await scan(label);
    await page.goto("https://www.youtube.com/@MKBHD", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("yt-tab-shape", { timeout: 20000 }).catch(() => {});
    await sleep(3000);
    const showChannel = await scan(label);
    check("F5 ja shortsMode=show: Shorts tab and chip visible", showChannel.shortsTab.some((t) => t.h > 0) && showSearch.shortsChip.some((c) => c.h > 0), { tab: showChannel.shortsTab, chip: showSearch.shortsChip });
    await setShorts("watch");
  }
}

const errs = [...ctx.errors, ...(await W.evaluate(() => globalThis.__errs || []))];
check("no extension errors", errs.length === 0, errs);
save("L-locale-shorts.json");
await context.close();
