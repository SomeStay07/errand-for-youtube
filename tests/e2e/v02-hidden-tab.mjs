import { rawLaunch } from "./rawcdp.mjs";
import { reporter, sleep } from "./harness.mjs";

const { check, save } = reporter();
const VIDEOS = (process.env.VIDEOS || "https://www.youtube.com/watch?v=jNQXAC9IVRw,https://www.youtube.com/watch?v=dQw4w9WgXcQ").split(",");
const b = await rawLaunch("hidden-raw", 9350);
await sleep(3000);
const welcome = (await b.list()).find((t) => t.url.endsWith("/welcome.html"));
const extId = welcome.url.split("/")[2];
await fetch(`http://127.0.0.1:9350/json/close/${welcome.id}`);
const sw = await b.connect((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`));
const js = (s) => sw.evaluate(s);

async function run(label, url, rename) {
  const xId = await js(`chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(t => t.id)`);
  await sleep(2500);
  const x = await b.connect((t) => t.type === "page" && t.url.startsWith(url));
  const vis = await x.evaluate("document.visibilityState");
  if (rename) await x.evaluate(`window.__ren = setInterval(() => { const r = document.querySelector("ytd-watch-flexy #related"); if (r) r.id = "related-renamed"; }, 100); 1`);
  await sleep(12000);
  const whileHidden = await js(`chrome.storage.session.get("health").then(d => (d.health || {})[${xId}] || null)`);
  const badgeHidden = await js(`chrome.action.getBadgeText({ tabId: ${xId} })`);
  const visStill = await x.evaluate("document.visibilityState");
  await js(`chrome.tabs.update(${xId}, { active: true }).then(() => 1)`);
  const t0 = Date.now();
  let after = null;
  while (!after && Date.now() - t0 < 15000) {
    after = await js(`chrome.storage.session.get("health").then(d => (d.health || {})[${xId}] || null)`);
    if (!after) await sleep(250);
  }
  const ms = Date.now() - t0;
  const badgeAfter = await js(`chrome.action.getBadgeText({ tabId: ${xId} })`);
  const visAfter = await x.evaluate("document.visibilityState");
  const dbg = await x.evaluate(`JSON.stringify({ href: location.href, renamed: document.querySelectorAll("#related-renamed").length, related: document.querySelectorAll("ytd-watch-flexy #related").length, ren: typeof window.__ren, consent: Boolean(document.querySelector("ytd-consent-bump-v2-lightbox")) })`);
  console.log(label, dbg);
  x.close();
  return { xId, vis, visStill, whileHidden, badgeHidden, after, ms, badgeAfter, visAfter };
}

const r1 = await run("forced", VIDEOS[0], true);
check("E2 hidden tab, forced missing #related: no health result while hidden", r1.vis === "hidden" && r1.visStill === "hidden" && r1.whileHidden === null && r1.badgeHidden !== "!", `visibility=${r1.vis}/${r1.visStill}; after 14.5 s hidden: health=${JSON.stringify(r1.whileHidden)} badge="${r1.badgeHidden}"`);
check("E2 check runs ~6 s after the tab becomes visible", r1.after !== null && r1.ms >= 5500 && r1.ms <= 9000 && r1.after.missing.includes("related") && r1.badgeAfter === "!", `visible=${r1.visAfter}; result after ${r1.ms} ms: ${JSON.stringify(r1.after)} badge="${r1.badgeAfter}"`);
const r2 = await run("clean", VIDEOS[1], false);
check("E2 healthy video opened in background: no false '!' after switching to it", r2.vis === "hidden" && r2.whileHidden === null && r2.after !== null && r2.after.missing.length === 0 && r2.badgeAfter !== "!", `while hidden: ${JSON.stringify(r2.whileHidden)}; after ${r2.ms} ms: ${JSON.stringify(r2.after)} badge="${r2.badgeAfter}"`);
save("E2-results.json");
b.kill();
