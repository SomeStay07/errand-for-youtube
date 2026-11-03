if (!globalThis.ErrandLib && typeof importScripts === "function") importScripts("lib.js");

const L = globalThis.ErrandLib;
let queue = Promise.resolve();

function enqueue(job) {
  queue = queue.then(job).catch(() => {});
}

async function recordVisit(kind) {
  const { stats = {} } = await chrome.storage.local.get("stats");
  await chrome.storage.local.set({ stats: L.addVisit(stats, kind, new Date()) });
}

async function recordHealth(tabId, page, missing) {
  await chrome.action.setBadgeText({ tabId, text: missing.length ? "!" : "" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
  const { health = {} } = await chrome.storage.session.get("health");
  health[tabId] = { page, missing, ts: Date.now() };
  await chrome.storage.session.set({ health });
  if (missing.length) {
    const { log = [] } = await chrome.storage.local.get("log");
    await chrome.storage.local.set({ log: L.appendLog(log, { page, missing }, Date.now()) });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  if (message.type === "visit" && (message.kind === "intended" || message.kind === "drift")) {
    enqueue(() => recordVisit(message.kind));
  }
  if (message.type === "close-tab" && tabId !== undefined) {
    chrome.tabs.remove(tabId);
  }
  if (message.type === "health" && tabId !== undefined && Array.isArray(message.missing)) {
    enqueue(() => recordHealth(tabId, message.page, message.missing));
  }
});

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.runtime.setUninstallURL(`${L.SITE_URL}/bye/`);
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const { health = {} } = await chrome.storage.session.get("health");
    if (!(tabId in health)) return;
    delete health[tabId];
    await chrome.storage.session.set({ health });
  });
});
