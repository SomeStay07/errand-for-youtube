import { launch, reporter, sleep, until, closeWelcome, finish, messages } from "./harness.mjs";

const { M } = messages();
const { check, save } = reporter();
const ctx = await launch({ name: "v03-notes", width: 340, height: 600 });
await closeWelcome(ctx);
const front = ctx.context.pages()[0] || (await ctx.context.newPage());
await front.bringToFront();
const [p] = await Promise.all([ctx.context.waitForEvent("page"), ctx.worker.evaluate((url) => chrome.tabs.create({ url, active: false }), `chrome-extension://${ctx.extId}/popup.html`)]);
await p.waitForURL(/popup\.html/, { timeout: 5000 }).catch(() => {});
await p.waitForLoadState("load");
const frontTab = await p.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t.id));
const popupTab = await p.evaluate(() => chrome.tabs.getCurrent().then((t) => t.id));
if (frontTab === popupTab) throw new Error("popup tab became the active tab; the health fixture needs a different active tab");
const setup = (o) => p.evaluate(async ({ done, rateNote, updateNote, missing, paused, tabId }) => {
  const L = globalThis.ErrandLib;
  await chrome.storage.local.clear();
  await chrome.storage.session.remove("health");
  const data = { settings: { ...L.DEFAULTS, mode: "relaxed" } };
  if (done !== undefined) data.stats = { [L.dayKey(new Date())]: { done, closed: 1 } };
  if (rateNote) data.rateNote = rateNote;
  if (updateNote) data.updateNote = updateNote;
  if (paused) data.pausedUntil = Date.now() + 60000;
  await chrome.storage.local.set(data);
  if (missing) {
    await chrome.storage.session.set({ health: { [tabId]: { page: "watch", missing, ts: Date.now() } } });
  }
}, { ...o, tabId: frontTab });
const open = async () => {
  await p.reload();
  await p.waitForFunction(() => document.getElementById("weekHint")?.textContent.length > 0 && document.getElementById("status")?.textContent.length > 0, null, { timeout: 5000 }).catch(() => {});
  await sleep(150);
};
const state = () => p.evaluate(async () => {
  const s = await chrome.storage.local.get(["rateNote", "updateNote"]);
  const h = document.getElementById("health");
  const hint = document.getElementById("weekHint");
  return {
    ...s,
    hint: hint.textContent,
    rateHref: hint.querySelector("a")?.href ?? null,
    dismiss: hint.querySelector("button")?.getAttribute("aria-label") ?? null,
    healthHidden: h.hidden,
    health: h.textContent,
    healthCls: h.className,
    healthHref: h.querySelector("a")?.href ?? null,
    reportBottom: Math.round(document.getElementById("report").getBoundingClientRect().bottom),
  };
});
const RATE = `${M.noteRate.message} ${M.rateErrand.message} ×`;
const NOTE = `${M.noteUpdated.message.replace("$VERSION$", "0.3")} ${M.noteUpdatedLink.message}`;

await setup({ done: 4, missing: [] });
await open();
let s = await state();
check("S5: 4 done -> errandsHint, no rate line", s.hint === M.errandsHint.message && !s.rateNote, s);

await setup({ done: 5, missing: [] });
await open();
s = await state();
check("S5: 5 done -> rate line with store reviews link and dismiss label", s.hint === RATE && s.rateHref.endsWith("/reviews") && s.dismiss === M.noteDismiss.message && s.rateNote.shown === 1 && s.rateNote.done === false && s.health === M.healthOk.message, s);
await open();
await open();
s = await state();
check("S5: third open still shows, shown=3", s.hint === RATE && s.rateNote.shown === 3, s.rateNote);
await open();
s = await state();
check("S5: fourth open after 3 shows -> gone", s.hint === M.errandsHint.message && s.rateNote.shown === 3, s);

await setup({ done: 5, missing: [] });
await open();
await p.click("#weekHint button");
({ value: s } = await until(state, (x) => x.rateNote?.done === true, 3000, 100));
check("S5: × restores errandsHint in place, done=true", s.hint === M.errandsHint.message && s.rateNote.done === true, s);
await open();
s = await state();
check("S5: next open after × has no rate line", s.hint === M.errandsHint.message, s.hint);

await setup({ done: 5, missing: [] });
await open();
const [tab] = await Promise.all([ctx.context.waitForEvent("page"), p.click("#weekHint a")]);
await tab.waitForURL(/chromewebstore/, { timeout: 8000 }).catch(() => {});
const rateUrl = tab.url();
await tab.close();
({ value: s } = await until(state, (x) => x.rateNote?.done === true, 3000, 100));
check("S5: Rate click opens reviews and ends the line", s.rateNote.done === true && /reviews/.test(rateUrl), { rateUrl, rateNote: s.rateNote });

await setup({ done: 5, missing: ["related"] });
await open();
s = await state();
check("S5: never while '!' shows", s.hint === M.errandsHint.message && !s.rateNote && s.healthCls === "warn", s);

await setup({ done: 5, missing: [], updateNote: { version: "0.3", shown: 0 } });
await open();
s = await state();
check("S6: note replaces ok entry, link to /changes/#v0.3, not warn style", s.health === NOTE && s.healthHref.endsWith("/changes/#v0.3") && s.healthCls === "" && !s.healthHidden && s.updateNote.shown === 1, s);
check("S6 wins over S5: no rate line in the same open", s.hint === M.errandsHint.message && !s.rateNote, s);
await open();
await open();
s = await state();
check("S6: shown 3 times", s.health === NOTE && s.updateNote.shown === 3, s.updateNote);
await open();
s = await state();
check("S6: fourth open -> health ok back, rate line takes over", s.health === M.healthOk.message && s.hint === RATE, s);

await setup({ done: 5, missing: ["related"], updateNote: { version: "0.3", shown: 0 } });
await open();
s = await state();
check("S6: '!' wins, note not counted", s.healthCls === "warn" && s.updateNote.shown === 0, s);

await setup({ done: 0, updateNote: { version: "0.3", shown: 0 }, paused: true });
await open();
s = await state();
check("S6: paused -> hidden, not counted", s.healthHidden && s.updateNote.shown === 0, s);

await setup({ done: 0, updateNote: { version: "0.3", shown: 1 } });
await open();
s = await state();
check("S6: no health entry -> note still shows", !s.healthHidden && s.health === NOTE && s.updateNote.shown === 2, s);
const [tab2] = await Promise.all([ctx.context.waitForEvent("page"), p.click("#health a")]);
await tab2.waitForURL(/\/changes\//, { timeout: 8000 }).catch(() => {});
const changes = tab2.url();
await tab2.close();
({ value: s } = await until(state, (x) => !x.updateNote, 3000, 100));
check("S6: link click opens /changes/#v0.3 and removes the note", !s.updateNote && changes.endsWith("/changes/#v0.3"), { changes, s });

await finish(ctx, check);
save("N-notes.json");
await ctx.context.close();
