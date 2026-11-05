import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, sleep, until, finish, distStale, OUT, EXT } from "./harness.mjs";

if (!process.env.E2E_GATE && !process.env.E2E_ALLOW_STALE && distStale().length) throw new Error(`${EXT} is older than the sources (${distStale().join(", ")}); run npm run build`);

const { check, save } = reporter();
const copy = join(OUT, "ext-copy");
rmSync(copy, { recursive: true, force: true });
cpSync(EXT, copy, { recursive: true });
const bg = join(copy, "background.js");
writeFileSync(bg, readFileSync(bg, "utf8") + `\nchrome.runtime.onInstalled.addListener((d) => chrome.storage.local.get("__installs").then(({ __installs = [] }) => chrome.storage.local.set({ __installs: [...__installs, d.reason + ":" + (d.previousVersion || "")] })));\n`);
const manifestPath = join(copy, "manifest.json");
const setVersion = (version) => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
};
const pageTargets = async (ctx) => (await (await fetch(`http://127.0.0.1:${ctx.port}/json/list`)).json()).filter((t) => t.type === "page").map((t) => t.url);
const opened = (tabs) => tabs.filter((u) => u.startsWith("chrome-extension://") || /^https?:/.test(u));
const read = async (ctx, keys) => {
  const [worker] = ctx.context.serviceWorkers().filter((w) => w.url().includes(ctx.extId)).slice(-1);
  return worker.evaluate((k) => chrome.storage.local.get(k).then((d) => ({ ...d, __version: chrome.runtime.getManifest().version })), keys);
};

setVersion("0.2.1");
let ctx = await launch({ name: "update", ext: copy, args: ["--enable-unsafe-extension-debugging"] });
const { value: first } = await until(async () => ctx.context.pages().filter((p) => p.url().endsWith("/welcome.html")), (w) => w.length > 0, 10000, 200);
await sleep(500);
check("A1 fresh install (0.2.1): one welcome tab", first.length === 1, `${first.length}`);
await first[0].locator('label.choice:has(input[value="subs"])').click();
const { value: fresh } = await until(() => read(ctx, ["updateNote", "settings"]), (d) => d.settings?.homeTarget === "subs", 5000, 200);
check("S6 fresh install stores no updateNote", fresh.updateNote === undefined, JSON.stringify(fresh));
await first[0].close();
const LEGACY_DAY = "2026-10-01";
const legacy = {
  settings: { mode: "auto", strictStart: "22:00", strictEnd: "06:00", homeTarget: "subs", shortsMode: "watch", hide: { related: true, endscreen: true, comments: false }, stopAutoplay: true, revealSeconds: 10, strictSkipUntil: Date.now() - 86400000, legacyFlag: true },
  stats: { [LEGACY_DAY]: { done: 3, closed: 2 } },
};
const seeder = await ctx.context.newPage();
await seeder.goto(`chrome-extension://${ctx.extId}/popup.html`);
await seeder.evaluate((d) => chrome.storage.local.set(d), legacy);
await seeder.close();

async function update(version, prev, note) {
  setVersion(version);
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${ctx.port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const reply = await new Promise((r) => {
    ws.addEventListener("message", (e) => r(JSON.parse(e.data)));
    ws.send(JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path: copy } }));
  });
  ws.close();
  if (reply.error) throw new Error(`Extensions.loadUnpacked: ${JSON.stringify(reply.error)}`);
  const probe = () => read(ctx, ["settings", "__installs", "updateNote"]).catch(() => null);
  const { value: back, ok } = await until(probe, (d) => d?.__version === version && d.__installs?.at(-1) === `update:${prev}`, 20000, 500);
  if (!ok) throw new Error(`extension did not come back as ${version} after update from ${prev}: ${JSON.stringify(back)}`);
  const { value: data } = note ? await until(probe, (d) => d?.updateNote !== undefined, 5000, 200) : { value: (await sleep(1500), await probe()) };
  const tabs = await pageTargets(ctx);
  console.log(`onInstalled reasons after ${version}:`, data.__installs);
  return { v: data.__version, tabs, data };
}

const patch = await update("0.2.2", "0.2.1", false);
check("A1 patch update 0.2.1 → 0.2.2 opens no tab", patch.v === "0.2.2" && patch.data.__installs?.at(-1) === "update:0.2.1" && opened(patch.tabs).length === 0, { version: patch.v, tabs: patch.tabs, reasons: patch.data.__installs });
const kept = (data) => ctx.worker.evaluate((st) => {
  const m = globalThis.ErrandLib.mergeSettings(st);
  return { homeTarget: m.homeTarget, mode: m.mode, window: `${m.strictStart}-${m.strictEnd}`, comments: m.hide.comments, chat: m.hide.chat, days: m.strictDays, legacyFlag: "legacyFlag" in m };
}, data.settings);
const keptPatch = await kept(patch.data);
check("A1 0.1-shaped settings (no hide.chat, no strictDays, stray key) survive the patch update", keptPatch.homeTarget === "subs" && keptPatch.mode === "auto" && keptPatch.window === "22:00-06:00" && keptPatch.comments === false && keptPatch.chat === false && Array.isArray(keptPatch.days) && keptPatch.days.length > 0 && !keptPatch.legacyFlag, keptPatch);
check("S6 patch update 0.2.1 → 0.2.2 stores no updateNote", patch.data.updateNote === undefined, JSON.stringify(patch.data.updateNote));

const minor = await update("0.3.0", "0.2.2", true);
check("A1 minor update 0.2.2 → 0.3.0 opens no tab", minor.v === "0.3.0" && minor.data.__installs?.at(-1) === "update:0.2.2" && opened(minor.tabs).length === 0, { version: minor.v, tabs: minor.tabs, reasons: minor.data.__installs });
const keptMinor = await kept(minor.data);
const statsMinor = await ctx.worker.evaluate(() => chrome.storage.local.get("stats").then((d) => d.stats));
check("A1 settings and stats from 0.1/0.2 survive the minor update", JSON.stringify(keptMinor) === JSON.stringify(keptPatch) && statsMinor?.[LEGACY_DAY]?.done === 3 && statsMinor[LEGACY_DAY].closed === 2, { keptMinor, stats: statsMinor?.[LEGACY_DAY] ?? null });
check("S6 minor update 0.2.2 → 0.3.0 stores updateNote { version: '0.3', shown: 0 }", minor.data.updateNote?.version === "0.3" && minor.data.updateNote?.shown === 0, JSON.stringify(minor.data.updateNote));
check("A1 plain browser restart opens no welcome tab", null, "Chrome for Testing reinstalls --load-extension on every launch (reason 'install'), so a restart cannot be simulated here; manual check");
await finish(ctx, check);
save("A-update-results.json");
await ctx.context.close();
