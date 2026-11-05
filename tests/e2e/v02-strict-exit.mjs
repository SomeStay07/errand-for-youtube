import { readFileSync } from "node:fs";
import { launch, reporter, sleep } from "./harness.mjs";

const M = JSON.parse(readFileSync(new URL("../../_locales/en/messages.json", import.meta.url), "utf8"));
const msg = (key, value = "") => M[key].message.replace(/\$\w+\$/, value);
const COUNT_PREFIX = M.strictOffCountdown.message.split("$")[0];
const countdownRe = new RegExp(`^${COUNT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)…$`);

const { check, save } = reporter();
const ctx = await launch({ name: "strict-exit", port: 9361 });
const { context, extId } = ctx;
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();

const POPUP = `chrome-extension://${extId}/popup.html`;
const ALL_DAY = { mode: "auto", strictStart: "00:00", strictEnd: "23:59", strictDays: [0, 1, 2, 3, 4, 5, 6] };
const NEVER = { mode: "auto", strictStart: "09:00", strictEnd: "18:00", strictDays: [] };

async function openPopup(settings) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 340, height: 900 });
  await page.goto(POPUP);
  if (settings) {
    await page.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
    await page.reload();
  }
  await sleep(600);
  return page;
}

const controls = (page) => page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const days = [...$("days").querySelectorAll("input")];
  return {
    mode: $("mode").value,
    modeDisabled: $("mode").disabled,
    timesDisabled: [$("strictStart").disabled, $("strictEnd").disabled],
    daysDisabled: days.map((d) => d.disabled),
    importDisabled: $("import").disabled,
    importDimmed: $("import").closest("label").classList.contains("disabled"),
    offHidden: $("strictOff").hidden,
    offText: $("strictOff").textContent,
    pauseHidden: $("pause").hidden,
    importHint: $("import").closest("label").title,
    live: [$("strictOff").getAttribute("aria-live"), $("pauseButton").getAttribute("aria-live"), $("announce").getAttribute("aria-live"), $("status").getAttribute("aria-live")],
  };
});
const stored = (page) => page.evaluate(() => chrome.storage.local.get(["settings", "strictOffAt"]));
const HINT = msg("importLocked");
const unlocked = (c) => !c.modeDisabled && !c.timesDisabled.some(Boolean) && !c.daysDisabled.some(Boolean) && !c.importDisabled && !c.importDimmed && !c.importHint && c.offHidden;
const locked = (c) => c.modeDisabled && c.timesDisabled.every(Boolean) && c.daysDisabled.length === 7 && c.daysDisabled.every(Boolean) && c.importDisabled && c.importDimmed && c.importHint === HINT && !c.offHidden;

let popup = await openPopup();
const fresh = await controls(popup);
check("K3 fresh install: strict controls and Import editable, no Turn off", unlocked(fresh) && fresh.mode === "relaxed", fresh);
await popup.close();

popup = await openPopup(NEVER);
const outside = await controls(popup);
check("K3 auto outside its window: select, times, days, Import editable", unlocked(outside) && outside.daysDisabled.length === 7, outside);
await popup.close();

popup = await openPopup(ALL_DAY);
const inside = await controls(popup);
check("K2 auto inside its window: select, times, days, Import disabled with a hint; 'Turn off until 23:59'", locked(inside) && inside.offText === msg("strictOffUntil", "23:59") && inside.pauseHidden, inside);
await popup.close();

popup = await openPopup({ mode: "strict" });
const strict = await controls(popup);
check("K2 strict: select and Import disabled, 'Turn off strict mode' shown", locked(strict) && strict.offText === msg("strictOffButton"), strict);
check("K countdown buttons are not live regions; the announcer and status line are polite", strict.live.join() === ",,polite,polite", strict.live);

await popup.click("#strictOff");
await sleep(300);
const c1 = await controls(popup);
const s1 = await stored(popup);
check("K2 Turn off starts a 10 s countdown stored for the background", [9, 10].includes(Number(c1.offText.match(countdownRe)?.[1])) && Number.isFinite(s1.strictOffAt), `${c1.offText}; ${JSON.stringify(s1)}`);
await sleep(2200);
const c2 = await controls(popup);
check("K2 countdown ticks and controls stay locked", c2.offText !== c1.offText && locked(c2), `${c1.offText} -> ${c2.offText}`);
await popup.click("#strictOff");
await sleep(300);
const c3 = await controls(popup);
const s3 = await stored(popup);
check("K2 second click cancels", c3.offText === msg("strictOffButton") && s3.strictOffAt === undefined, `${c3.offText}; ${JSON.stringify(s3)}`);
await sleep(11000);
const s4 = await stored(popup);
check("K2 cancelled countdown keeps strict", s4.settings.mode === "strict", JSON.stringify(s4));

await popup.evaluate(() => {
  globalThis.__spoken = [];
  for (const id of ["announce", "status"]) {
    const node = document.getElementById(id);
    new MutationObserver(() => globalThis.__spoken.push(`${id}: ${node.textContent}`)).observe(node, { childList: true, characterData: true, subtree: true });
  }
});
await popup.click("#strictOff");
const seq = [];
const clickAt = Date.now();
while (Date.now() - clickAt < 12500) {
  const c = await controls(popup);
  if (!seq.length || seq.at(-1).text !== c.offText || seq.at(-1).hidden !== c.offHidden) seq.push({ t: Date.now() - clickAt, text: c.offText, hidden: c.offHidden });
  if (c.offHidden) break;
  await sleep(100);
}
const countdown = seq.filter((x) => countdownRe.test(x.text)).map((x) => Number(x.text.match(/\d+/)[0]));
const done = seq.at(-1);
const live = await controls(popup);
const s5 = await stored(popup);
check("K2 countdown 10…1, then mode = relaxed", countdown.join(",") === "10,9,8,7,6,5,4,3,2,1" && s5.settings.mode === "relaxed" && s5.strictOffAt === undefined, `${countdown.join(",")}; done at ${done.t} ms; ${JSON.stringify(s5)}`);
const spoken = await popup.evaluate(() => globalThis.__spoken);
check("K live regions speak only at the countdown start and end", spoken.length === 2 && spoken[0].startsWith("announce: ") && countdownRe.test(spoken[0].slice(10)) && spoken[1] === `status: ${msg("statusNormal")}`, spoken);
check("K2 open popup unlocks live when the countdown ends", unlocked(live) && live.mode === "relaxed" && !live.pauseHidden, live);
await popup.close();

popup = await openPopup({ mode: "strict" });
await popup.click("#strictOff");
await sleep(300);
await popup.close();
await sleep(11500);
const probe = await openPopup();
const s6 = await stored(probe);
const c6 = await controls(probe);
check("K2 closing the popup does not cancel; the background finishes it", s6.settings.mode === "relaxed" && s6.strictOffAt === undefined && unlocked(c6), JSON.stringify(s6));
await probe.close();

popup = await openPopup(ALL_DAY);
await popup.click("#strictOff");
await sleep(10800);
const s7 = await stored(popup);
const c7 = await controls(popup);
const endToday = new Date(new Date().setHours(23, 59, 0, 0)).getTime();
check("K2 Turn off in the schedule skips only this window: mode stays auto, skip until 23:59", s7.settings.mode === "auto" && s7.settings.strictSkipUntil === endToday && s7.settings.strictStart === "00:00", JSON.stringify(s7.settings));
check("K2 skipped window: controls editable, Pause available", unlocked(c7) && c7.mode === "auto" && !c7.pauseHidden, c7);
await popup.close();

popup = await openPopup({ ...ALL_DAY, strictSkipUntil: Date.now() - 1000 });
await sleep(800);
const s8 = await stored(popup);
const c8 = await controls(popup);
check("K expired skip is cleaned by the background and the window locks again", s8.settings.strictSkipUntil === undefined && s8.settings.mode === "auto" && locked(c8), JSON.stringify(s8.settings));
await popup.close();

popup = await openPopup({ mode: "strict" });
await popup.evaluate(() => chrome.storage.local.set({ strictOffAt: Date.now() - 24 * 60 * 60 * 1000 }));
await sleep(1000);
const s9 = await stored(popup);
check("K stale countdown from the day before is dropped, strict stays", s9.settings.mode === "strict" && s9.strictOffAt === undefined, JSON.stringify(s9));
await popup.close();

const swErrs = await ctx.worker.evaluate(() => globalThis.__errs || []);
const errors = [...ctx.errors, ...swErrs];
check("no extension errors", errors.length === 0, errors);
save("strict-exit.json");
await context.close();
