import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, sleep, OUT, EXT } from "./harness.mjs";

const { check, save } = reporter();
const copy = join(OUT, "ext-copy");
rmSync(copy, { recursive: true, force: true });
cpSync(EXT, copy, { recursive: true });
const bg = join(copy, "background.js");
const hasNote = readFileSync(bg, "utf8").includes("updateNote");
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
  const probe = await ctx.context.newPage();
  await probe.goto(`chrome-extension://${ctx.extId}/popup.html`);
  const data = await probe.evaluate((k) => chrome.storage.local.get(k).then((d) => ({ ...d, __version: chrome.runtime.getManifest().version })), keys);
  await probe.close();
  return data;
};
const noteCheck = (name, ok, detail) => check(name, hasNote ? ok : null, hasNote ? detail : `background.js in ${EXT} has no updateNote (S6, Lane 3, not built yet); ${detail}`);

setVersion("0.2.1");
let ctx = await launch({ name: "update", port: 9342, ext: copy, args: ["--enable-unsafe-extension-debugging"] });
await sleep(2000);
const first = ctx.context.pages().filter((p) => p.url().endsWith("/welcome.html"));
check("A1 fresh install (0.2.1): one welcome tab", first.length === 1, `${first.length}`);
await first[0].locator('label.choice:has(input[value="subs"])').click();
await sleep(300);
const fresh = await read(ctx, ["updateNote"]);
noteCheck("S6 fresh install stores no updateNote", fresh.updateNote === undefined, JSON.stringify(fresh));
await first[0].close();
await sleep(500);

async function update(version) {
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
  let data = null;
  for (let i = 0; i < 20 && !data; i++) {
    await sleep(1000);
    data = await read(ctx, ["settings", "__installs", "updateNote"]).catch(() => null);
  }
  const tabs = await pageTargets(ctx);
  if (!data) throw new Error(`extension did not come back after chrome.runtime.reload() to ${version}`);
  console.log(`onInstalled reasons after ${version}:`, data.__installs);
  return { v: data.__version, tabs, data };
}

const patch = await update("0.2.2");
check("A1 patch update 0.2.1 → 0.2.2 opens no tab", patch.v === "0.2.2" && patch.data.__installs?.at(-1) === "update:0.2.1" && opened(patch.tabs).length === 0, { version: patch.v, tabs: patch.tabs, reasons: patch.data.__installs });
check("A1 settings kept across update", patch.data.settings?.homeTarget === "subs", `homeTarget=${patch.data.settings?.homeTarget}`);
noteCheck("S6 patch update 0.2.1 → 0.2.2 stores no updateNote", patch.data.updateNote === undefined, JSON.stringify(patch.data.updateNote));

const minor = await update("0.3.0");
check("A1 minor update 0.2.2 → 0.3.0 opens no tab", minor.v === "0.3.0" && minor.data.__installs?.at(-1) === "update:0.2.2" && opened(minor.tabs).length === 0, { version: minor.v, tabs: minor.tabs, reasons: minor.data.__installs });
noteCheck("S6 minor update 0.2.2 → 0.3.0 stores updateNote { version: '0.3', shown: 0 }", minor.data.updateNote?.version === "0.3" && minor.data.updateNote?.shown === 0, JSON.stringify(minor.data.updateNote));
check("A1 plain browser restart opens no welcome tab", null, "Chrome for Testing reinstalls --load-extension on every launch (reason 'install'), so a restart cannot be simulated here; manual check");
console.log("errors:", JSON.stringify(ctx.errors));
save("A-update-results.json");
await ctx.context.close();
