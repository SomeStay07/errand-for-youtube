import { join } from "node:path";
import { launch, reporter, consent, sleep, OUT } from "./harness.mjs";

const { check, save } = reporter();
const ctx = await launch({ name: "qa-subs-leak", port: 9393 });
const { context } = ctx;
await sleep(1500);
for (const p of context.pages()) if (p.url().includes("welcome.html")) await p.close();
const page = context.pages()[0] || (await context.newPage());
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
await consent(page);
const W = () => ctx.worker;
const tabId = await page.evaluate(() => new Promise((r) => chrome.runtime ? r(null) : r(null)));
const ids = async () => W().evaluate(() => chrome.tabs.query({}).then((t) => t.map((x) => x.id)));
const [yt] = await ids();
const setHome = (v) => W().evaluate((home) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...globalThis.ErrandLib.mergeSettings(settings), homeTarget: home } })), v);

async function run(label, { wrapper, hidden, home }) {
  await setHome(home);
  await W().evaluate((id) => chrome.action.setBadgeText({ tabId: id, text: "" }), yt);
  await W().evaluate(() => chrome.storage.local.remove("log").then(() => chrome.storage.session.remove("health")));
  await page.goto("https://www.youtube.com/feed/subscriptions", { waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  await page.waitForSelector("ytd-app", { state: "attached", timeout: 10000 });
  const built = await page.evaluate(async ({ wrapper, hidden }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const browse = document.createElement("ytd-browse");
    browse.setAttribute("page-subtype", "subscriptions");
    browse.id = "qa-leak";
    browse.style.cssText = `display:${hidden ? "none" : "block"};position:fixed;top:60px;left:0;width:400px;z-index:99999`;
    (document.querySelector("ytd-app") || document.body).append(browse);
    await wait(300);
    const section = document.createElement("ytd-rich-section-renderer");
    section.style.display = "block";
    browse.append(section);
    await wait(300);
    let holder = section.querySelector(":scope > #content");
    if (wrapper === "content" && !holder) {
      holder = document.createElement("div");
      holder.id = "content";
      section.append(holder);
    }
    if (wrapper !== "content") {
      holder = document.createElement("div");
      holder.className = "qa-wrap";
      section.append(holder);
    }
    holder.style.display = "block";
    const shelf = document.createElement("ytd-rich-shelf-renderer");
    shelf.style.cssText = "display:block;height:200px;background:#c00";
    holder.append(shelf);
    await wait(300);
    return { stampedContent: Boolean(section.querySelector(":scope > #content")), shelfParent: shelf.parentElement?.id || shelf.parentElement?.className, connected: shelf.isConnected };
  }, { wrapper, hidden });
  const injectedMs = Date.now() - t0;
  await sleep(1000);
  const vis = await page.evaluate(() => ({ sectionHeight: Math.round((document.querySelector("#qa-leak ytd-rich-shelf-renderer")?.getBoundingClientRect().height ?? -1)), erPage: document.documentElement.dataset.erPage, showHome: document.documentElement.hasAttribute("data-er-show-home") }));
  await sleep(13000);
  const badge = await W().evaluate((id) => chrome.action.getBadgeText({ tabId: id }), yt);
  const { health = {} } = await W().evaluate(() => chrome.storage.session.get("health"));
  const { log = [] } = await W().evaluate(() => chrome.storage.local.get("log"));
  await page.screenshot({ path: join(OUT, `S-subs-${label}.png`) });
  return { injectedMs, built, ...vis, badge, health: health[yt] || null, log: log.map((e) => `${e.page}:${e.missing.join("+")}`) };
}

const leak = await run("leak", { wrapper: "other", hidden: false, home: "ask" });
check("subs leak: visible shelf outside the hide rule (no #content wrapper), Home=ask → '!' naming home", leak.badge === "!" && leak.health?.missing?.includes("home") && leak.log.includes("subs:home"), leak);
const exact = await run("exact", { wrapper: "content", hidden: false, home: "ask" });
check("subs exact structure (> #content >) is hidden by hide.css → no '!'", exact.sectionHeight <= 0 && exact.badge !== "!", exact);
const hiddenCtl = await run("hidden", { wrapper: "other", hidden: true, home: "ask" });
check("subs control: same structure display:none → no '!'", hiddenCtl.badge !== "!" && !hiddenCtl.log.length, hiddenCtl);
const feed = await run("feed", { wrapper: "other", hidden: false, home: "feed" });
check("subs control: Home='YouTube's feed' + visible shelf → no '!'", feed.badge !== "!" && !feed.log.length, feed);
await setHome("ask");
const errs = [...ctx.errors, ...(await W().evaluate(() => globalThis.__errs || []))];
check("no extension errors", errs.length === 0, errs);
save("S-subs-leak.json");
await context.close();
