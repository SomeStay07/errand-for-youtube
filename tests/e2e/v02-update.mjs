import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, reporter, sleep, OUT, EXT } from "./harness.mjs";

const { check, save } = reporter();
const copy = join(OUT, "ext-copy");
rmSync(copy, { recursive: true, force: true });
cpSync(EXT, copy, { recursive: true });
const bg = join(copy, "background.js");
writeFileSync(bg, readFileSync(bg, "utf8") + `\nchrome.runtime.onInstalled.addListener((d) => chrome.storage.local.get("__installs").then(({ __installs = [] }) => chrome.storage.local.set({ __installs: [...__installs, d.reason + ":" + (d.previousVersion || "")] })));\n`);

let ctx = await launch({ name: "update", port: 9342, ext: copy });
await sleep(2000);
const first = ctx.context.pages().filter((p) => p.url().endsWith("/welcome.html"));
check("A1 fresh install: one welcome tab", first.length === 1, `${first.length}`);
await first[0].locator('label.choice:has(input[value="subs"])').click();
await sleep(300);
const v1 = await ctx.worker.evaluate(() => chrome.runtime.getManifest().version);
const keeper = await ctx.context.newPage();
await keeper.goto("about:blank");
await first[0].close();
await sleep(500);
await ctx.context.close();

const manifestPath = join(copy, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = "0.2.1";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

ctx = await launch({ name: "update", port: 9342, ext: copy, keep: true });
await ctx.worker.evaluate(() => {
  globalThis.__installed = [];
  chrome.runtime.onInstalled.addListener((d) => globalThis.__installed.push(d.reason));
}).catch(() => {});
await sleep(4000);
const v2 = await ctx.worker.evaluate(() => chrome.runtime.getManifest().version);
const targets = (await (await fetch(`http://127.0.0.1:${ctx.port}/json/list`)).json()).map((t) => `${t.type}:${t.url}`);
const welcomeAfter = targets.filter((u) => u.includes("welcome.html")).length;
const probe = await ctx.context.newPage();
await probe.goto(`chrome-extension://${ctx.extId}/popup.html`);
const s = await probe.evaluate(() => chrome.storage.local.get(["settings", "__installs"]));
console.log("onInstalled reasons so far:", s.__installs);
check("A1 update (0.2.0 → 0.2.1 on relaunch) opens no welcome tab", v2 === "0.2.1" && welcomeAfter === 0, `version ${v1} → ${v2}; welcome tabs after update: ${welcomeAfter}`);
check("A1 settings kept across update", s.settings?.homeTarget === "subs", `homeTarget=${s.settings?.homeTarget}`);
for (const p of ctx.context.pages()) if (p.url().includes("welcome.html")) await p.close();
await probe.close();
await sleep(500);
await ctx.context.close();

ctx = await launch({ name: "update", port: 9342, ext: copy, keep: true });
await sleep(4000);
const t3 = (await (await fetch(`http://127.0.0.1:${ctx.port}/json/list`)).json()).filter((t) => t.url.includes("welcome.html")).length;
const probe3 = await ctx.context.newPage();
await probe3.goto(`chrome-extension://${ctx.extId}/popup.html`);
const inst = await probe3.evaluate(() => chrome.storage.local.get("__installs"));
console.log("onInstalled reasons after restart:", inst.__installs);
check("A1 plain browser restart opens no welcome tab", t3 === 0, `${t3}; reasons ${JSON.stringify(inst.__installs)}`);
console.log("errors:", JSON.stringify(ctx.errors));
save("A-update-results.json");
await ctx.context.close();
