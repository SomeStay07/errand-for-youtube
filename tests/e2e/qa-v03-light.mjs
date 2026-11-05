import { join } from "node:path";
import { launch, reporter, consent, until, finish, sleep, closeWelcome, OUT, QUERY } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "light" });
const { context, extId } = ctx;
await closeWelcome(ctx);
const page = context.pages().find((p) => !p.url().startsWith("chrome-extension://")) || (await context.newPage());
await page.emulateMedia({ colorScheme: "light" });

const LOOK = (sel) => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (n) => {
    for (let e = n; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c;
    }
    return parse(getComputedStyle(document.body).backgroundColor).length ? parse(getComputedStyle(document.body).backgroundColor) : [255, 255, 255];
  };
  const el = document.querySelector(sel);
  if (!el) return { sel, present: false };
  const cs = getComputedStyle(el);
  const fg = parse(cs.color);
  const bg = bgOf(el);
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  const r = el.getBoundingClientRect();
  return {
    sel,
    present: true,
    visible: r.width > 0 && r.height > 0 && el.checkVisibility({ visibilityProperty: true }),
    color: cs.color,
    bg: `rgb(${bg.slice(0, 3).join(",")})`,
    border: cs.borderColor,
    contrast: +((a + 0.05) / (b + 0.05)).toFixed(2),
    box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    htmlDark: document.documentElement.hasAttribute("dark"),
    pageBg: getComputedStyle(document.querySelector("ytd-app") || document.body).backgroundColor,
  };
};
const look = (sel) => page.evaluate(LOOK, sel);
const shot = (name) => page.screenshot({ path: join(OUT, `light-${name}.png`) });

await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
await page.waitForSelector("#er-intent", { state: "visible", timeout: 15000 }).catch(() => {});
await sleep(1500);
const scheme = await page.evaluate(() => ({ light: matchMedia("(prefers-color-scheme: light)").matches, dark: document.documentElement.hasAttribute("dark") }));
check("light: YouTube renders light (no html[dark])", scheme.light && !scheme.dark, scheme);
const h1 = await look("#er-intent h1");
const input = await look("#er-intent input");
const intentBtn = await look("#er-intent button, #er-intent [type=submit]");
const footer = await look("#er-intent p, #er-intent small, #er-intent footer");
check("light home: question visible", h1.visible && input.visible, { h1, input });
check("light home: heading contrast >= 4.5", h1.contrast >= 4.5, h1);
check("light home: input text contrast >= 4.5", input.contrast >= 4.5, input);
check("light home: footnote contrast >= 4.5", !footer.present || footer.contrast >= 4.5, footer);
console.log("home button", JSON.stringify(intentBtn));
await shot("1-home");

await page.locator("#er-intent input").click();
await page.keyboard.type(QUERY);
await page.keyboard.press("Enter");
await page.waitForURL(/results/, { timeout: 20000 });
await until(() => page.evaluate(() => document.querySelectorAll("ytd-search ytd-video-renderer, ytd-search yt-lockup-view-model").length), (n) => n > 5, 15000, 500);
await sleep(2000);
const pill = await look("#er-pill");
const pillText = await page.evaluate(() => {
  const p = document.getElementById("er-pill");
  return [...(p?.querySelectorAll("*") || [])].filter((n) => n.childElementCount === 0 && n.textContent.trim()).map((n) => n.tagName + ":" + n.textContent.trim().slice(0, 30));
});
const pillParts = [];
for (const s of ["#er-pill a", "#er-pill button", "#er-pill span"]) pillParts.push(await look(s));
check("light search: pill visible", pill.visible, pill);
check("light search: pill text contrast >= 4.5", [pill, ...pillParts].filter((x) => x.present && x.visible).every((x) => x.contrast >= 4.5), { pill, pillParts, pillText });
await shot("2-search");

await page.locator('ytd-video-renderer a#thumbnail[href^="/watch"], yt-lockup-view-model a[href^="/watch"]').first().click();
await page.waitForURL(/watch/, { timeout: 20000 });
await until(() => page.evaluate(() => Boolean(document.getElementById("er-reveal") && document.getElementById("er-comments"))), Boolean, 20000, 500);
await sleep(1500);
const reveal = await look("#er-reveal");
const comments = await look("#er-comments");
check("light watch: reveal button visible, contrast >= 4.5", reveal.visible && reveal.contrast >= 4.5, reveal);
check("light watch: comments button visible, contrast >= 4.5", comments.visible && comments.contrast >= 4.5, comments);
const pillWatch = await look("#er-pill");
check("light watch: pill contrast >= 4.5", !pillWatch.visible || pillWatch.contrast >= 4.5, pillWatch);
await shot("3-watch");
await page.locator("#er-comments").scrollIntoViewIfNeeded().catch(() => {});
await sleep(500);
await shot("3b-watch-comments-button");
await page.evaluate(() => scrollTo(0, 0));
await page.locator("#er-reveal").click();
await sleep(1200);
const countdown = await look("#er-reveal");
check("light watch: reveal countdown state readable (contrast >= 4.5)", countdown.contrast >= 4.5, countdown);
await shot("3c-reveal-countdown");
await until(() => page.evaluate(() => document.documentElement.hasAttribute("data-er-reveal")), Boolean, 15000, 250);
await sleep(1500);
const revealed = await page.evaluate(() => ({ revealed: document.documentElement.hasAttribute("data-er-reveal"), related: [...document.querySelectorAll("#related yt-lockup-view-model, #related ytd-compact-video-renderer")].filter((n) => n.getClientRects().length).length }));
check("light watch: reveal shows related", revealed.revealed && revealed.related > 0, revealed);
await shot("3d-revealed");

const popup = await context.newPage();
await popup.emulateMedia({ colorScheme: "light" });
await popup.setViewportSize({ width: 340, height: 700 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForSelector("#pauseButton", { state: "visible", timeout: 5000 }).catch(() => {});
await sleep(500);
const pop = {};
for (const s of ["body", "#status", "#pauseButton", "h1, header", "label", "summary", "a"]) pop[s] = await popup.evaluate(LOOK, s);
const popBg = await popup.evaluate(() => getComputedStyle(document.body).backgroundColor);
check("light popup: light background", /255, 255, 255|rgb\(2[3-5]\d, 2[3-5]\d, 2[3-5]\d\)/.test(popBg), popBg);
check("light popup: texts contrast >= 4.5", Object.values(pop).filter((x) => x.present && x.visible).every((x) => x.contrast >= 4.5), pop);
await popup.screenshot({ path: join(OUT, "light-5-popup.png"), fullPage: true });

await finish(ctx, check);
save("light.json");
await context.close();
