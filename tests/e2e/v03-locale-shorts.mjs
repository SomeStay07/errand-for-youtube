import { join } from "node:path";
import { launch, reporter, consent, sleep, until, prefCookie, closeWelcome, healthOf, recheck, settingsApi, finish, OUT } from "./harness.mjs";

const { check, save } = reporter();
const LANGS = (process.env.HLS || "ja,de,en").split(",");
const SHORTS = { ja: "ショート", de: "Shorts", en: "Shorts" };
const ctx = await launch({ name: "v03-locale-shorts" });
const { context } = ctx;
await closeWelcome(ctx);
const page = context.pages()[0] || (await context.newPage());
const W = ctx.worker;
const setShorts = (mode) => settingsApi(ctx).set({ shortsMode: mode });
const tabsOk = (x) => x.shortsTab.length > 0 && x.shortsTab.every((t) => t.h === 0) && x.otherTabs >= 2;
const tabsCheck = (name, x) => check(name, x.shortsTab.length > 0 && x.otherTabs >= 2 ? tabsOk(x) : x.shortsTab.length > 0 ? false : null, x.shortsTab.length > 0 ? x : `precondition: no "${x.label}" tab rendered (${JSON.stringify(x)})`);
const scan = (label) =>
  page.evaluate((label) => {
    const h = (n) => Math.round(n.getBoundingClientRect().height);
    const tabs = [...document.querySelectorAll("yt-tab-shape")].map((n) => ({ title: n.getAttribute("tab-title"), h: h(n) }));
    const chips = [...document.querySelectorAll("yt-chip-cloud-chip-renderer")].map((n) => ({ title: n.textContent.trim(), h: h(n) }));
    const guide = document.querySelector('ytd-guide-entry-renderer a[href^="/shorts"], ytd-mini-guide-entry-renderer a[href^="/shorts"]');
    return {
      hl: document.documentElement.lang,
      label,
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
  const { value: ch } = await until(() => scan(label), tabsOk, 3000, 200);
  await page.screenshot({ path: join(OUT, `L-${hl}-channel.png`) });
  tabsCheck(`F5 ${hl} channel: Shorts tab "${label}" height 0 within 3 s, other tabs visible`, ch);
  await page.goto("https://www.youtube.com/@MKBHD/videos", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("yt-tab-shape", { timeout: 20000 }).catch(() => {});
  const { value: chv } = await until(() => scan(label), tabsOk, 3000, 200);
  tabsCheck(`F5 ${hl} channel Videos tab: Shorts tab hidden, other tabs visible`, chv);
  await page.goto("https://www.youtube.com/results?search_query=minecraft", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("yt-chip-cloud-chip-renderer", { timeout: 20000 }).catch(() => {});
  const chipsOk = (x) => x.shortsChip.length > 0 && x.shortsChip.every((c) => c.h === 0) && x.otherChips >= 2;
  const { value: se } = await until(() => scan(label), chipsOk, 3000, 200);
  await page.screenshot({ path: join(OUT, `L-${hl}-search.png`) });
  check(`F5 ${hl} search: Shorts chip "${label}" height 0, other chips visible`, se.shortsChip.length > 0 ? chipsOk(se) : null, se.shortsChip.length > 0 ? se : `precondition: no "${label}" chip rendered (${JSON.stringify(se)})`);
  const at = await recheck(ctx);
  const { value: hs } = await until(() => healthOf(ctx), (h) => h.entry?.ts > at, 20000, 500);
  check(`F5 ${hl}: no '!' on these pages`, hs.entry?.ts > at && hs.badge !== "!" && hs.entry.missing.length === 0, hs);
  if (hl === "ja") {
    await setShorts("show");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("yt-chip-cloud-chip-renderer", { timeout: 20000 }).catch(() => {});
    const { value: showSearch } = await until(() => scan(label), (x) => x.shortsChip.some((c) => c.h > 0), 5000, 200);
    await page.goto("https://www.youtube.com/@MKBHD", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("yt-tab-shape", { timeout: 20000 }).catch(() => {});
    const { value: showChannel } = await until(() => scan(label), (x) => x.shortsTab.some((t) => t.h > 0), 5000, 200);
    check("F5 ja shortsMode=show: Shorts tab and chip visible", showChannel.shortsTab.some((t) => t.h > 0) && showSearch.shortsChip.some((c) => c.h > 0), { tab: showChannel.shortsTab, chip: showSearch.shortsChip });
    await setShorts("watch");
  }
}

await finish(ctx, check);
save("L-locale-shorts.json");
await context.close();
