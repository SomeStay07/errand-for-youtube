import { launch, sleep, OUT, setLang, resetLang } from "./harness.mjs";
import { join } from "node:path";

const ALL_DAY = { mode: "auto", strictStart: "00:00", strictEnd: "23:59", strictDays: [0, 1, 2, 3, 4, 5, 6] };
const locales = [["en", "en-US", 9371], ["ru", "ru-RU", 9372], ["de", "de-DE", 9373]];
const facts = [];

try {
for (const [tag, locale, port] of locales) {
  setLang(locale);
  const ctx = await launch({ name: `ux-strict-${tag}`, locale, port });
  const { context, extId } = ctx;
  for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
  const page = await context.newPage();
  await page.setViewportSize({ width: 340, height: 1100 });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  const shot = async (name) => {
    await page.evaluate(() => { const d = document.querySelector("details"); if (d) d.open = true; });
    await sleep(300);
    await page.screenshot({ path: join(OUT, `ux-strict-${tag}-${name}.png`), fullPage: true });
  };
  const set = async (s) => {
    await page.evaluate((v) => chrome.storage.local.set({ settings: v }), s);
    await page.reload();
    await sleep(600);
  };
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await set({ mode: "relaxed" });
    await shot(`off-${scheme}`);
    await set({ mode: "strict" });
    await shot(`always-${scheme}`);
    await set(ALL_DAY);
    await shot(`schedule-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await set({ mode: "strict" });
  await page.click("#strictOff");
  await sleep(2300);
  await shot("countdown-light");
  facts.push(await page.evaluate((tag) => {
    const $ = (id) => document.getElementById(id);
    const r = (id) => $(id).getBoundingClientRect();
    return {
      tag,
      status: $("status").textContent,
      off: $("strictOff").textContent,
      offAria: $("strictOff").getAttribute("aria-live") || $("strictOff").closest("[aria-live]")?.id || null,
      modeTitle: $("mode").title || null,
      lockHint: [...document.querySelectorAll("section")][2].innerText.replace(/\s+/g, " ").slice(0, 300),
      pauseHidden: $("pause").hidden,
      scrollW: document.documentElement.scrollWidth,
      timesW: r("schedule").width,
    };
  }, tag));
  await page.click("#strictOff");
  await context.close();
}
} finally {
  console.log("AppleLanguages reset:", resetLang());
}
console.log(JSON.stringify(facts, null, 2));
