import { launch, reporter, sleep, until, closeWelcome, finish, messages } from "./harness.mjs";

const { M, msg } = messages();
const COUNT_PREFIX = M.strictOffCountdown.message.split("$")[0];
const countdownRe = new RegExp(`^${COUNT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)…$`);

const { check, save } = reporter();
const ctx = await launch({ name: "strict-exit" });
const { context, extId } = ctx;
await closeWelcome(ctx);

const POPUP = `chrome-extension://${extId}/popup.html`;
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const window_ = () => ({ mode: "auto", strictStart: hhmm(Date.now() - 3600e3), strictEnd: hhmm(Date.now() + 3600e3), strictDays: [0, 1, 2, 3, 4, 5, 6] });
const NEVER = { mode: "auto", strictStart: "09:00", strictEnd: "18:00", strictDays: [] };

async function openPopup(settings) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 340, height: 900 });
  await page.goto(POPUP);
  if (settings) {
    await page.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
    await page.reload();
  }
  await page.waitForFunction(() => document.getElementById("status")?.textContent.length > 0, null, { timeout: 5000 }).catch(() => {});
  await sleep(200);
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
const untilUntil = (page, end) =>
  page.evaluate((e) => {
    const [h, m] = e.split(":").map(Number);
    const clock = new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, h, m));
    return [chrome.i18n.getMessage("strictOffUntil", e), chrome.i18n.getMessage("strictOffUntil", clock)];
  }, end);
const HINT = msg("importLocked");
const unlocked = (c) => !c.modeDisabled && !c.timesDisabled.some(Boolean) && !c.daysDisabled.some(Boolean) && !c.importDisabled && !c.importDimmed && !c.importHint && c.offHidden;
const locked = (c) => c.modeDisabled && c.timesDisabled.every(Boolean) && c.daysDisabled.length === 7 && c.daysDisabled.every(Boolean) && c.importDisabled && c.importDimmed && c.importHint === HINT && !c.offHidden;
const countOf = (c) => Number(c.offText.match(countdownRe)?.[1]);

let popup = await openPopup();
const fresh = await controls(popup);
check("K3 fresh install: strict controls and Import editable, no Turn off", unlocked(fresh) && fresh.mode === "relaxed", fresh);
await popup.close();

popup = await openPopup(NEVER);
const outside = await controls(popup);
check("K3 auto outside its window: select, times, days, Import editable", unlocked(outside) && outside.daysDisabled.length === 7, outside);
await popup.close();

let win = window_();
popup = await openPopup(win);
const inside = await controls(popup);
const offTexts = await untilUntil(popup, win.strictEnd);
check(`K2 auto inside its window (${win.strictStart}–${win.strictEnd}): select, times, days, Import disabled with a hint; 'Turn off until ${win.strictEnd}'`, locked(inside) && offTexts.includes(inside.offText) && inside.pauseHidden, { inside, offTexts });
await popup.close();

popup = await openPopup({ mode: "strict" });
const strict = await controls(popup);
check("K2 strict: select and Import disabled, 'Turn off strict mode' shown", locked(strict) && strict.offText === msg("strictOffButton"), strict);
check("K countdown buttons are not live regions; the announcer and status line are polite", strict.live.join() === ",,polite,polite", strict.live);

await popup.click("#strictOff");
const { value: c1 } = await until(() => controls(popup), (c) => Number.isFinite(countOf(c)), 2000, 50);
const s1 = await stored(popup);
check("K2 Turn off starts a 10 s countdown stored for the background", [9, 10].includes(countOf(c1)) && Number.isFinite(s1.strictOffAt), `${c1.offText}; ${JSON.stringify(s1)}`);
const { value: c2 } = await until(() => controls(popup), (c) => countOf(c) < countOf(c1), 3000, 100);
check("K2 countdown ticks and controls stay locked", countOf(c2) < countOf(c1) && locked(c2), `${c1.offText} -> ${c2.offText}`);
await popup.click("#strictOff");
const { value: c3 } = await until(() => controls(popup), (c) => c.offText === msg("strictOffButton"), 2000, 50);
const s3 = await stored(popup);
check("K2 second click cancels", c3.offText === msg("strictOffButton") && s3.strictOffAt === undefined, `${c3.offText}; ${JSON.stringify(s3)}`);
await sleep(11500);
const s4 = await stored(popup);
check("K2 cancelled countdown keeps strict", s4.settings.mode === "strict" && s4.strictOffAt === undefined, JSON.stringify(s4));

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
while (Date.now() - clickAt < 14000) {
  const c = await controls(popup);
  if (!seq.length || seq.at(-1).text !== c.offText || seq.at(-1).hidden !== c.offHidden) seq.push({ t: Date.now() - clickAt, text: c.offText, hidden: c.offHidden });
  if (c.offHidden) break;
  await sleep(100);
}
const countdown = seq.filter((x) => countdownRe.test(x.text)).map((x) => Number(x.text.match(countdownRe)[1]));
const gaps = countdown.slice(1).reduce((n, v, i) => n + (countdown[i] - v - 1), 0);
const monotonic = countdown.every((v, i) => i === 0 || v < countdown[i - 1]);
const done = seq.at(-1);
const s5 = await stored(popup);
check("K2 countdown runs 10…1 (decreasing, ≤ 1 missed sample), ends in 9.5–11.5 s, then mode = relaxed", [9, 10].includes(countdown[0]) && countdown.at(-1) === 1 && monotonic && gaps <= 1 && done.hidden && done.t >= 9500 && done.t <= 11500 && s5.settings.mode === "relaxed" && s5.strictOffAt === undefined, `${countdown.join(",")}; done at ${done.t} ms; ${JSON.stringify(s5)}`);
const spoken = await popup.evaluate(() => globalThis.__spoken);
check("K live regions speak only at the countdown start and end", spoken.length === 2 && spoken[0].startsWith("announce: ") && countdownRe.test(spoken[0].slice(10)) && spoken[1] === `status: ${msg("statusNormal")}`, spoken);
const { value: live } = await until(() => controls(popup), (c) => unlocked(c) && c.mode === "relaxed" && !c.pauseHidden, 2000, 100);
check("K2 open popup unlocks live when the countdown ends", unlocked(live) && live.mode === "relaxed" && !live.pauseHidden, live);
await popup.close();

popup = await openPopup({ mode: "strict" });
await popup.click("#strictOff");
await until(() => stored(popup), (s) => Number.isFinite(s.strictOffAt), 2000, 50);
const closedAt = Date.now();
await popup.close();
const probe = await openPopup();
const { value: s6, ms: ms6 } = await until(() => stored(probe), (s) => s.settings?.mode === "relaxed" && s.strictOffAt === undefined, 16000, 250);
const { value: c6 } = await until(() => controls(probe), unlocked, 3000, 100);
check("K2 closing the popup does not cancel; the background finishes it", s6.settings?.mode === "relaxed" && s6.strictOffAt === undefined && unlocked(c6), { finishedAfterMs: Date.now() - closedAt, ms6, s6 });
await probe.close();

win = window_();
popup = await openPopup(win);
const expectedSkip = await ctx.worker.evaluate((s) => globalThis.ErrandLib.nextStrictEnd(globalThis.ErrandLib.mergeSettings(s), new Date()), win);
await popup.click("#strictOff");
const { value: s7 } = await until(() => stored(popup), (s) => s.settings?.strictSkipUntil !== undefined, 15000, 250);
const { value: c7 } = await until(() => controls(popup), (c) => unlocked(c) && !c.pauseHidden, 3000, 100);
check(`K2 Turn off in the schedule skips only this window: mode stays auto, skip until ${win.strictEnd}`, s7.settings.mode === "auto" && s7.settings.strictSkipUntil === expectedSkip && s7.settings.strictStart === win.strictStart, { stored: s7.settings, expectedSkip });
check("K2 skipped window: controls editable, Pause available", unlocked(c7) && c7.mode === "auto" && !c7.pauseHidden, c7);
await popup.close();

popup = await openPopup({ ...window_(), strictSkipUntil: Date.now() - 1000 });
const { value: s8 } = await until(() => stored(popup), (s) => s.settings?.strictSkipUntil === undefined, 5000, 100);
const { value: c8 } = await until(() => controls(popup), locked, 3000, 100);
check("K expired skip is cleaned by the background and the window locks again", s8.settings.strictSkipUntil === undefined && s8.settings.mode === "auto" && locked(c8), JSON.stringify(s8.settings));
await popup.close();

popup = await openPopup({ mode: "strict" });
await popup.evaluate(() => chrome.storage.local.set({ strictOffAt: Date.now() - 24 * 60 * 60 * 1000 }));
const { value: s9 } = await until(() => stored(popup), (s) => s.strictOffAt === undefined, 5000, 100);
check("K stale countdown from the day before is dropped, strict stays", s9.settings.mode === "strict" && s9.strictOffAt === undefined, JSON.stringify(s9));
await popup.close();

await finish(ctx, check);
save("strict-exit.json");
await context.close();
