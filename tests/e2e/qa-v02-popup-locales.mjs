import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { launch, reporter, sleep, OUT } from "./harness.mjs";

const { check, save } = reporter();
const LOCALES = (process.env.LOCALES || "en-US,ru-RU,es-ES,pt-BR,de-DE").split(",");
const setLang = (l) => execFileSync("defaults", ["write", "com.google.chrome.for.testing", "AppleLanguages", `("${l}")`]);
const MISSING = ["player", "related", "comments", "autoplay", "endscreen", "shorts", "home", "results"];

const STATES = {
  default: async (p) => {
    await p.evaluate(() => chrome.storage.session.remove("health"));
    await p.evaluate(() => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.DEFAULTS, mode: "auto" }, stats: { [globalThis.ErrandLib.dayKey(new Date())]: { done: 12, closed: 9 } } }));
  },
  health: async (p) => {
    await p.evaluate(async (missing) => {
      const tab = await chrome.tabs.getCurrent();
      await chrome.storage.local.set({ settings: globalThis.ErrandLib.DEFAULTS });
      await chrome.storage.session.set({ health: { [tab.id]: { page: "watch", missing, ts: Date.now() } } });
    }, MISSING);
  },
  paused: async (p) => {
    await p.evaluate(() => chrome.storage.local.set({ pausedUntil: Date.now() + 14 * 60 * 1000 }));
  },
  countdown: async (p) => {
    await p.evaluate(() => chrome.storage.local.remove(["pausedUntil", "pauseStartsAt"]));
  },
  strictAuto: async (p) => {
    await p.evaluate(() => chrome.storage.local.remove(["pausedUntil", "pauseStartsAt"]).then(() => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.DEFAULTS, mode: "auto", strictStart: "00:00", strictEnd: "23:59", strictDays: [0, 1, 2, 3, 4, 5, 6] } })));
  },
  strictAlways: async (p) => {
    await p.evaluate(() => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.DEFAULTS, mode: "strict" } }));
  },
};

const measure = (p) => p.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const over = [];
  for (const node of document.querySelectorAll("body *")) {
    if (node.closest("[hidden]") || !node.getClientRects().length) continue;
    const r = node.getBoundingClientRect();
    if (r.right > W + 0.5 || r.left < -0.5) over.push(`${node.tagName}#${node.id} right=${Math.round(r.right)}`);
    const tag = node.tagName;
    if ((tag === "BUTTON" || tag === "A" || tag === "SPAN" || tag === "P" || tag === "H1" || tag === "H2" || tag === "SUMMARY") && node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0) over.push(`${tag}#${node.id} text overflow ${node.scrollWidth}>${node.clientWidth} "${node.textContent.slice(0, 40)}"`);
  }
  const canvas = document.createElement("canvas").getContext("2d");
  const clipped = [];
  for (const sel of document.querySelectorAll("select")) {
    if (!sel.getClientRects().length) continue;
    const cs = getComputedStyle(sel);
    canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 16;
    for (const opt of sel.options) {
      const w = canvas.measureText(opt.textContent).width;
      if (w > room) clipped.push(`${sel.id}:"${opt.textContent}" ${Math.round(w)}>${Math.round(room)}`);
    }
  }
  const rowsWrapped = [...document.querySelectorAll("label.row")].filter((l) => l.getClientRects().length).map((l) => {
    const span = l.querySelector("span");
    const ctrl = l.querySelector("select, input");
    const a = span?.getBoundingClientRect();
    const b = ctrl?.getBoundingClientRect();
    return a && b && a.right > b.left + 0.5 ? `${span.textContent} overlaps control` : null;
  }).filter(Boolean);
  const empty = [...document.querySelectorAll("[data-i18n]")].filter((n) => !n.textContent.trim()).map((n) => n.dataset.i18n);
  return {
    ui: chrome.i18n.getUILanguage(),
    hScroll: document.documentElement.scrollWidth > W,
    over,
    clipped,
    rowsWrapped,
    empty,
    height: document.documentElement.scrollHeight,
    status: document.getElementById("status").textContent,
    pause: document.getElementById("pause").hidden ? null : document.getElementById("pauseButton").textContent,
    strictOff: document.getElementById("strictOff").hidden ? null : document.getElementById("strictOff").textContent,
    health: document.getElementById("health").hidden ? null : document.getElementById("health").textContent,
    bg: getComputedStyle(document.body).backgroundColor,
  };
});

try {
  for (const locale of LOCALES) {
    setLang(locale);
    const ctx = await launch({ name: `qa-loc-${locale}`, locale, port: 9383, width: 340, height: 900 });
    await sleep(1500);
    for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
    const p = await ctx.context.newPage();
    await p.setViewportSize({ width: 340, height: 1000 });
    await p.goto(`chrome-extension://${ctx.extId}/popup.html`);
    await sleep(500);
    for (const theme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: theme });
      for (const [state, prep] of Object.entries(STATES)) {
        await prep(p);
        await p.reload();
        await sleep(500);
        if (state === "default") {
          await p.click("details > summary");
          await sleep(150);
        }
        if (state === "countdown") {
          await p.click("#pauseButton");
          await sleep(400);
        }
        if (state === "strictAlways") {
          await p.click("#strictOff");
          await sleep(400);
        }
        const m = await measure(p);
        const shot = join(OUT, `L-popup-${locale}-${theme}-${state}.png`);
        await p.screenshot({ path: shot, fullPage: true });
        const ok = !m.hScroll && m.over.length === 0 && m.clipped.length === 0 && m.rowsWrapped.length === 0 && m.empty.length === 0 && m.ui.slice(0, 2) === locale.slice(0, 2);
        check(`popup ${locale} ${theme} ${state}: fits 340px`, ok, `ui=${m.ui} h=${m.height} bg=${m.bg} status="${m.status}" pause="${m.pause}" strictOff="${m.strictOff}" health="${(m.health || "").slice(0, 80)}" over=${JSON.stringify(m.over)} clipped=${JSON.stringify(m.clipped)} wrapped=${JSON.stringify(m.rowsWrapped)} empty=${m.empty} → ${shot}`);
        if (state === "countdown" || state === "strictAlways") await p.evaluate(() => chrome.storage.local.remove(["pauseStartsAt", "strictOffAt"]));
      }
    }
    const errs = [...ctx.errors, ...(await ctx.worker.evaluate(() => globalThis.__errs || []).catch(() => []))];
    check(`popup ${locale}: no extension errors`, errs.length === 0, errs);
    await ctx.context.close();
  }
} finally {
  setLang("en-US");
  console.log("AppleLanguages reset:", execFileSync("defaults", ["read", "com.google.chrome.for.testing", "AppleLanguages"]).toString().replace(/\s+/g, " "));
}
save("L-popup-locales.json");
