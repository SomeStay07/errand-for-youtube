if (!globalThis.ErrandLib && typeof importScripts === "function") importScripts("lib.js");

const L = globalThis.ErrandLib;
let queue = Promise.resolve();

function enqueue(job) {
  queue = queue.then(job).catch(() => {});
}

async function recordErrand(kind, id) {
  const { stats = {}, errandLast } = await chrome.storage.local.get(["stats", "errandLast"]);
  const { count, last } = L.errandEvent(errandLast, kind, id);
  const next = { errandLast: last };
  if (count) next.stats = L.addCount(stats, kind, new Date());
  await chrome.storage.local.set(next);
}

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

function clock(ms) {
  return new Intl.DateTimeFormat(chrome.i18n.getUILanguage(), { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

async function patchSettings(patch) {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: L.patchSettings(settings, patch) });
}

async function syncHealthyTitles(title) {
  const { health = {} } = await chrome.storage.session.get("health");
  for (const [tabId, entry] of Object.entries(health)) {
    if (!entry.missing.length) await chrome.action.setTitle({ tabId: Number(tabId), title }).catch(() => {});
  }
}

async function syncPauseBadge() {
  const { pausedUntil, settings } = await chrome.storage.local.get(["pausedUntil", "settings"]);
  const strict = L.isStrict(L.mergeSettings(settings), new Date());
  if (L.isPaused(pausedUntil, Date.now()) && !strict) {
    const title = t("titlePaused", clock(pausedUntil));
    await chrome.action.setBadgeText({ text: "II" });
    await chrome.action.setBadgeBackgroundColor({ color: "#5f6368" });
    await chrome.action.setTitle({ title });
    await syncHealthyTitles(title);
    return;
  }
  const title = strict ? t("titleStrict") : t("titleOn");
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title });
  await syncHealthyTitles(title);
  if (pausedUntil !== undefined && !L.isPaused(pausedUntil, Date.now())) await chrome.storage.local.remove("pausedUntil");
}

async function recordHealth(tabId, page, missing) {
  if (!(await chrome.tabs.get(tabId).catch(() => null))) return;
  const { health = {} } = await chrome.storage.session.get("health");
  health[tabId] = { page, missing, ts: Date.now() };
  await chrome.storage.session.set({ health });
  if (missing.length) {
    const { log = [] } = await chrome.storage.local.get("log");
    await chrome.storage.local.set({ log: L.appendLog(log, { page, missing }, Date.now()) });
  }
  try {
    if (missing.length) {
      await chrome.action.setBadgeText({ tabId, text: "!" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
      await chrome.action.setTitle({ tabId, title: t("titleBroken") });
    } else {
      await chrome.action.setBadgeText({ tabId, text: null });
      await chrome.action.setTitle({ tabId, title: await chrome.action.getTitle({}) });
    }
  } catch {}
}

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id;
  const incognito = Boolean(sender.tab?.incognito);
  enqueue(syncPauseBadge);
  if (message.type === "errand" && message.kind === "done" && !incognito) {
    enqueue(() => recordErrand("done", message.id));
  }
  if (message.type === "close-tab" && tabId !== undefined) {
    if (!incognito && message.errand !== null && message.errand !== undefined) {
      enqueue(() => recordErrand("closed", message.errand));
    }
    chrome.tabs.remove(tabId);
  }
  const fromExtension = typeof sender.url === "string" && sender.url.startsWith(chrome.runtime.getURL(""));
  if (message.type === "patch" && fromExtension && message.patch && typeof message.patch === "object") {
    enqueue(() => patchSettings(message.patch));
  }
  if (message.type === "health" && tabId !== undefined && Array.isArray(message.missing)) {
    enqueue(() => recordHealth(tabId, message.page, message.missing));
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  try {
    chrome.runtime.setUninstallURL(`${L.SITE_URL}/bye/`);
  } catch {}
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(syncPauseBadge);
  enqueue(finishStrictExit);
});

let startTimer = 0;

async function startPendingPause() {
  const { pauseStartsAt, pausedUntil, settings } = await chrome.storage.local.get(["pauseStartsAt", "pausedUntil", "settings"]);
  clearTimeout(startTimer);
  if (pauseStartsAt !== undefined && L.isStrict(L.mergeSettings(settings), new Date())) {
    await chrome.storage.local.remove("pauseStartsAt");
    return;
  }
  if (!L.isPauseStarting(pauseStartsAt, Date.now())) {
    if (pauseStartsAt !== undefined && pauseStartsAt <= Date.now()) {
      await chrome.storage.local.remove("pauseStartsAt");
      if (L.canPause(L.mergeSettings(settings), new Date(), pausedUntil)) {
        await chrome.storage.local.set({ pausedUntil: Date.now() + L.PAUSE_MS });
      }
    } else if (pauseStartsAt !== undefined) {
      await chrome.storage.local.remove("pauseStartsAt");
    }
    return;
  }
  startTimer = setTimeout(() => enqueue(startPendingPause), pauseStartsAt - Date.now() + 50);
}

let strictTimer = 0;

async function finishStrictExit() {
  const { strictOffAt, settings } = await chrome.storage.local.get(["strictOffAt", "settings"]);
  clearTimeout(strictTimer);
  const current = L.mergeSettings(settings);
  if (current.strictSkipUntil !== undefined && !L.isSkipped(current, new Date())) {
    await chrome.storage.local.set({ settings: { ...current, strictSkipUntil: undefined } });
    return;
  }
  const state = L.strictExit(current, strictOffAt, new Date());
  if (state === "waiting") {
    strictTimer = setTimeout(() => enqueue(finishStrictExit), strictOffAt - Date.now() + 50);
    return;
  }
  if (strictOffAt === undefined) return;
  await chrome.storage.local.remove("strictOffAt");
  if (state === "due") await chrome.storage.local.set({ settings: L.endStrict(current, new Date()) });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.pausedUntil || changes.settings)) enqueue(syncPauseBadge);
  if (area === "local" && (changes.pauseStartsAt || changes.settings)) enqueue(startPendingPause);
  if (area === "local" && (changes.strictOffAt || changes.settings)) enqueue(finishStrictExit);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(async () => {
    const { health = {} } = await chrome.storage.session.get("health");
    if (!(tabId in health)) return;
    delete health[tabId];
    await chrome.storage.session.set({ health });
  });
});
