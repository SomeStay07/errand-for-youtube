import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, sleep, OUT, setLang, resetLang } from "./harness.mjs";

const { check, save } = reporter();
const LOCALES = (process.env.LOCALES || "en-US,de-DE,ru-RU").split(",");
const FOLD = 600;
const messages = (locale) => {
  const dir = { en: "en", de: "de", ru: "ru", es: "es", pt: "pt_BR" }[locale.slice(0, 2)];
  return JSON.parse(readFileSync(new URL(`../../_locales/${dir}/messages.json`, import.meta.url), "utf8"));
};

const health = (missing) => async (p) => {
  await p.evaluate(async (m) => {
    const tab = await chrome.tabs.getCurrent();
    await chrome.storage.session.set({ health: { [tab.id]: { page: "watch", missing: m, ts: Date.now() } } });
  }, missing);
};

const withStats = (settings) => (p) =>
  p.evaluate((s) => {
    const L = globalThis.ErrandLib;
    return chrome.storage.local.set({ settings: { ...L.DEFAULTS, ...s }, stats: { [L.dayKey(new Date())]: { done: 12, closed: 9 } } });
  }, settings);

const STATES = {
  day1: async (p) => {
    await p.evaluate(() => chrome.storage.session.remove("health"));
    await p.evaluate(() => chrome.storage.local.clear());
  },
  returning: async (p) => {
    await withStats({})(p);
    await health([])(p);
  },
  returningBroken: async (p) => {
    await withStats({})(p);
    await health(["player", "related", "comments", "autoplay", "endscreen", "shorts", "home", "results"])(p);
  },
  strictAuto: async (p) => {
    await withStats({ mode: "auto", strictStart: "00:00", strictEnd: "23:59", strictDays: [0, 1, 2, 3, 4, 5, 6] })(p);
    await health([])(p);
  },
};

const measure = (p) => p.evaluate(() => {
  const box = (id) => {
    const node = document.getElementById(id);
    if (!node || node.hidden || !node.getClientRects().length) return null;
    const r = node.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom + window.scrollY), text: node.textContent };
  };
  return {
    ui: chrome.i18n.getUILanguage(),
    height: document.documentElement.scrollHeight,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    report: box("report"),
    reportHref: document.getElementById("report").href,
    strictOff: box("strictOff"),
    rate: box("rate"),
    rateHref: document.getElementById("rate").href,
    copy: box("copyLink"),
    copyHref: document.getElementById("copyLink").href,
    status: getComputedStyle(document.getElementById("status")).fontWeight,
    days: [...document.querySelectorAll("#days label")].filter((l) => l.getClientRects().length).map((l) => { const r = l.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
  };
});

try {
  for (const locale of LOCALES) {
    setLang(locale);
    const M = messages(locale);
    const ctx = await launch({ name: `polish-${locale}`, locale, port: 9391, width: 340, height: FOLD });
    await sleep(1500);
    for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
    const origin = `chrome-extension://${ctx.extId}`;
    const p = await ctx.context.newPage();
    await p.addInitScript(() => {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => {
        globalThis.__copied = text;
        return write(text);
      };
    });
    await p.setViewportSize({ width: 340, height: FOLD });
    await p.goto(`${origin}/popup.html`);
    await sleep(500);
    for (const theme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: theme });
      for (const [state, prep] of Object.entries(STATES)) {
        await prep(p);
        await p.reload();
        await sleep(600);
        const m = await measure(p);
        const shot = join(OUT, `popup-${locale}-${theme}-${state}.png`);
        await p.screenshot({ path: shot });
        const tag = `${locale} ${theme} ${state}`;
        check(`K1 ${tag}: Report above the ${FOLD}px fold`, Boolean(m.report) && m.report.bottom <= FOLD && m.ui.slice(0, 2) === locale.slice(0, 2), `report=${JSON.stringify(m.report)} h=${m.height} ui=${m.ui} → ${shot}`);
        check(`K3 ${tag}: Report link carries version diagnostics`, /entry\.870279470=0\.\d+\.\d+/.test(m.reportHref), m.reportHref.slice(0, 160));
        if (state === "strictAuto") check(`K2 ${tag}: Turn strict off above the fold`, Boolean(m.strictOff) && m.strictOff.bottom <= FOLD, JSON.stringify(m.strictOff));
        check(`P ${tag}: Rate and Copy link in the footer, store hrefs`, Boolean(m.rate && m.copy) && m.rateHref.endsWith("jhpaobkpbnidoaemnkojmkmnddoegdhg/reviews") && m.copyHref.endsWith("jhpaobkpbnidoaemnkojmkmnddoegdhg") && !m.hScroll && m.rate.text === M.rateErrand.message && m.copy.text === M.copyLink.message, JSON.stringify({ rate: m.rate, copy: m.copy, h: m.height }));
        check(`N ${tag}: status 600, day toggles >= 24x24`, Number(m.status) === 600 && m.days.every(([w, h]) => w >= 24 && h >= 24), JSON.stringify({ status: m.status, days: m.days }));
      }
    }
    await p.click("#copyLink");
    await sleep(300);
    const copied = await p.evaluate(async () => ({ text: document.getElementById("copyLink").textContent, live: document.getElementById("copyLink").getAttribute("aria-live"), clip: globalThis.__copied ?? null, url: location.href }));
    await sleep(2200);
    const reverted = await p.evaluate(() => document.getElementById("copyLink").textContent);
    check(`P2 ${locale}: Copy link puts STORE_URL on the clipboard, says Copied, reverts`, copied.clip === "https://chromewebstore.google.com/detail/jhpaobkpbnidoaemnkojmkmnddoegdhg" && copied.text === M.copied.message && copied.live === "polite" && reverted === M.copyLink.message && copied.url.endsWith("/popup.html"), JSON.stringify({ copied, reverted }));
    const errs = [...ctx.errors];
    check(`${locale}: no extension errors`, errs.length === 0, errs);
    await ctx.context.close();
  }
} finally {
  console.log("AppleLanguages reset:", resetLang());
}
save("polish-popup-fold.json");
