import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { launch, reporter, sleep, OUT } from "./harness.mjs";

const { check, save } = reporter();
const LOCALES = (process.env.LOCALES || "en-US,ru-RU,es-ES,pt-BR,de-DE").split(",");
const setLang = (l) => execFileSync("defaults", ["write", "com.google.chrome.for.testing", "AppleLanguages", `("${l}")`]);

try {
  for (const locale of LOCALES) {
    setLang(locale);
    const ctx = await launch({ name: `loc-${locale}`, locale, port: 9343, width: 420, height: 900 });
    await sleep(2000);
    const page = ctx.context.pages().find((p) => p.url().endsWith("/welcome.html"));
    if (!page) {
      check(`${locale} welcome opened`, false);
      await ctx.context.close();
      continue;
    }
    await page.setViewportSize({ width: 420, height: 900 });
    await page.reload();
    await sleep(600);
    for (const id of ["ask", "shorts", "subs"]) {
      await page.locator(`label.choice:has(input[value="${id}"])`).click();
      await sleep(250);
      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const over = [];
        for (const node of document.querySelectorAll("main, main *")) {
          const r = node.getBoundingClientRect();
          if (r.right > doc.clientWidth + 0.5 || node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== "visible") over.push(`${node.tagName}#${node.id}.${node.className} right=${Math.round(r.right)}`);
        }
        const rows = (node) => {
          const lh = parseFloat(getComputedStyle(node).lineHeight) || 22;
          return Math.round(node.getBoundingClientRect().height / lh);
        };
        return {
          ui: chrome.i18n.getUILanguage(),
          lang: doc.lang,
          dir: doc.dir,
          title: document.title,
          hScroll: doc.scrollWidth > doc.clientWidth,
          over,
          lines: [...document.querySelectorAll("#lines li")].map((li) => ({ rows: rows(li), len: li.textContent.length })),
          maxLabelRows: Math.max(...[...document.querySelectorAll("label.choice span")].map(rows)),
          h1Rows: rows(document.querySelector("h1")),
          buttonRows: rows(document.getElementById("open")),
          hintRows: rows(document.querySelector(".hint")),
          empty: [...document.querySelectorAll("[data-i18n]")].filter((n) => !n.textContent.trim()).map((n) => n.dataset.i18n),
        };
      });
      const shot = join(OUT, `B-welcome-${locale}-${id}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      const maxRows = Math.max(...m.lines.map((l) => l.rows));
      const ok = !m.hScroll && m.over.length === 0 && maxRows <= 3 && m.empty.length === 0 && m.dir === "ltr";
      check(`A6 ${locale} ${id}: no overflow at 420px, lines ≤3 rows`, ok, `ui=${m.ui} lang=${m.lang} dir=${m.dir} title="${m.title}" hScroll=${m.hScroll} overflowing=${JSON.stringify(m.over)} lineRows=${m.lines.map((l) => l.rows).join("/")} labelRows=${m.maxLabelRows} h1Rows=${m.h1Rows} buttonRows=${m.buttonRows} hintRows=${m.hintRows} empty=${m.empty.join(",")} → ${shot}`);
      if (id === "ask") check(`A6 ${locale} UI language applied`, m.ui.slice(0, 2) === locale.slice(0, 2), m.ui);
    }
    const popup = await ctx.context.newPage();
    await popup.setViewportSize({ width: 420, height: 900 });
    await popup.goto(`chrome-extension://${ctx.extId}/popup.html`);
    await sleep(600);
    const pm = await popup.evaluate(() => {
      const b = document.getElementById("pauseButton");
      const width = document.body.getBoundingClientRect().width;
      return { width, btn: b.textContent, btnW: b.scrollWidth, btnClient: b.clientWidth, docOver: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    await popup.locator("#pauseButton").click();
    await sleep(1200);
    const cd = await popup.evaluate(() => {
      const b = document.getElementById("pauseButton");
      return { text: b.textContent, over: b.scrollWidth > b.clientWidth + 1 };
    });
    await popup.screenshot({ path: join(OUT, `B-popup-${locale}-countdown.png`), clip: { x: 0, y: 0, width: 420, height: 260 } });
    check(`C ${locale} popup pause button text fits`, !cd.over && pm.btnW <= pm.btnClient + 1, `"${pm.btn}" / "${cd.text}"`);
    await popup.close();
    if (ctx.errors.length) console.log(locale, "errors:", JSON.stringify(ctx.errors));
    await ctx.context.close();
  }
} finally {
  setLang("en-US");
  console.log("AppleLanguages reset:", execFileSync("defaults", ["read", "com.google.chrome.for.testing", "AppleLanguages"]).toString().replace(/\s+/g, " "));
}
save("B-locales-results.json");
