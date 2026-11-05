const L = globalThis.ErrandLib;
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));
const LANG = chrome.i18n.getUILanguage();

const HIDE_KEYS = [
  ["related", "hideRelated"],
  ["endscreen", "hideEndscreen"],
  ["comments", "hideComments"],
];

const MORE_KEYS = [
  ["chat", "hideChat"],
  ["notifications", "hideNotifications"],
  ["metrics", "hideMetrics"],
  ["thumbs", "hideThumbs"],
];

const HEALTH_KEYS = {
  player: "healthPlayer",
  related: "healthRelated",
  comments: "healthComments",
  autoplay: "healthAutoplay",
  endscreen: "healthEndscreen",
  shorts: "healthShorts",
  home: "healthHome",
  results: "healthResults",
};

let settings = L.mergeSettings();
let pausedUntil = null;
let pauseStartsAt = null;
let pauseTimer = 0;
let strictOffAt = null;
let strictTimer = 0;
let pickedAuto = false;
let lastStrict = false;
let editedSchedule = false;
let pauseCounting = false;
let strictCounting = false;

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "checked") node.checked = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function localize() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = t("@@bidi_dir");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
}

function weekdayOrder() {
  let first = 1;
  try {
    const info = new Intl.Locale(LANG);
    const weekInfo = info.getWeekInfo?.() ?? info.weekInfo;
    if (weekInfo?.firstDay) first = weekInfo.firstDay % 7;
  } catch {}
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
}

function weekdayName(day, style = "short") {
  return new Intl.DateTimeFormat(LANG, { weekday: style }).format(new Date(2026, 10, 1 + day));
}

function save(patch) {
  editedSchedule = ["mode", "strictStart", "strictEnd", "strictDays"].some((key) => key in patch);
  settings = L.patchSettings(settings, patch);
  renderStatus();
  chrome.runtime.sendMessage({ type: "patch", patch }).catch(async () => {
    const { settings: stored } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: L.patchSettings(stored, patch) });
  });
}

function announce(text) {
  $("announce").textContent = text;
}

function isPausedNow() {
  return !L.isStrict(settings, new Date()) && L.isPaused(pausedUntil, Date.now());
}

function renderStatus() {
  let text = t("statusNormal");
  if (settings.mode === "strict") text = t("statusStrictAlways");
  else if (L.isStrict(settings, new Date())) text = t("statusStrictUntil", settings.strictEnd);
  else if (isPausedNow()) {
    const time = new Intl.DateTimeFormat(LANG, { hour: "numeric", minute: "2-digit" }).format(new Date(pausedUntil));
    text = t("statusPaused", time);
  }
  if ($("status").textContent !== text) $("status").textContent = text;
  $("schedule").hidden = settings.mode !== "auto";
  renderPause();
  renderStrictLock();
}

function renderStrictLock() {
  const strictNow = L.isStrict(settings, new Date());
  if (settings.mode !== "auto" || (strictNow && !lastStrict && !editedSchedule)) pickedAuto = false;
  lastStrict = strictNow;
  editedSchedule = false;
  const locked = strictNow && !pickedAuto;
  for (const node of [$("mode"), $("strictStart"), $("strictEnd"), $("import"), ...$("days").querySelectorAll("input")]) {
    node.disabled = locked;
  }
  const importLabel = $("import").closest("label");
  importLabel.classList.toggle("disabled", locked);
  if (locked) {
    importLabel.title = t("importLocked");
    importLabel.setAttribute("aria-description", t("importLocked"));
  } else {
    importLabel.removeAttribute("title");
    importLabel.removeAttribute("aria-description");
  }
  const button = $("strictOff");
  button.hidden = !locked;
  clearTimeout(strictTimer);
  if (locked && L.strictExit(settings, strictOffAt, new Date()) === "waiting") {
    button.textContent = t("strictOffCountdown", Math.max(1, Math.ceil((strictOffAt - Date.now()) / 1000)));
    if (!strictCounting) announce(button.textContent);
    strictCounting = true;
    strictTimer = setTimeout(renderStatus, 250);
    return;
  }
  strictCounting = false;
  button.textContent = settings.mode === "auto" ? t("strictOffUntil", settings.strictEnd) : t("strictOffButton");
  if (settings.mode === "auto") strictTimer = setTimeout(renderStatus, 60_000 - (Date.now() % 60_000) + 50);
}

function onStrictOffClick() {
  if (L.strictExit(settings, strictOffAt, new Date()) === "waiting") {
    chrome.storage.local.remove("strictOffAt");
    strictOffAt = null;
  } else if (L.isStrict(settings, new Date())) {
    strictOffAt = Date.now() + L.PAUSE_WAIT_S * 1000;
    chrome.storage.local.set({ strictOffAt });
  }
  renderStatus();
}

function renderPause() {
  const row = $("pause");
  const button = $("pauseButton");
  if (healthEntry !== undefined) $("health").hidden = isPausedNow() || !healthEntry;
  clearTimeout(pauseTimer);
  const wasCounting = pauseCounting;
  pauseCounting = false;
  if (L.isStrict(settings, new Date())) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  if (L.isPauseStarting(pauseStartsAt, Date.now())) {
    const left = Math.max(1, Math.ceil((pauseStartsAt - Date.now()) / 1000));
    button.textContent = t("pauseCountdown", left);
    if (!wasCounting) announce(button.textContent);
    pauseCounting = true;
    pauseTimer = setTimeout(renderPause, 250);
    return;
  }
  button.textContent = isPausedNow() ? t("resumeButton") : t("pauseButton");
}

function onPauseClick() {
  if (isPausedNow()) {
    chrome.storage.local.remove("pausedUntil");
    pausedUntil = null;
  } else if (L.isPauseStarting(pauseStartsAt, Date.now())) {
    chrome.storage.local.remove("pauseStartsAt");
    pauseStartsAt = null;
  } else if (L.canPause(settings, new Date(), pausedUntil)) {
    pauseStartsAt = Date.now() + L.PAUSE_WAIT_S * 1000;
    chrome.storage.local.set({ pauseStartsAt });
  }
  renderStatus();
}

function syncSchedule(next) {
  for (const key of ["mode", "strictStart", "strictEnd", "strictDays", "strictSkipUntil"]) settings[key] = next[key];
  for (const key of ["mode", "strictStart", "strictEnd"]) $(key).value = settings[key];
  const boxes = $("days").querySelectorAll("input");
  weekdayOrder().forEach((day, i) => {
    if (boxes[i]) boxes[i].checked = settings.strictDays.includes(day);
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.pausedUntil) pausedUntil = changes.pausedUntil.newValue ?? null;
  if (changes.pauseStartsAt) pauseStartsAt = changes.pauseStartsAt.newValue ?? null;
  if (changes.strictOffAt) strictOffAt = changes.strictOffAt.newValue ?? null;
  if (changes.settings?.newValue) syncSchedule(L.mergeSettings(changes.settings.newValue));
  if (changes.pausedUntil || changes.pauseStartsAt || changes.strictOffAt || changes.settings) renderStatus();
});

function renderStats(stats) {
  const { done, closed } = L.errandTotals(stats, new Date());
  $("week").hidden = done === 0;
  if (done) $("summary").textContent = t("errandsSummary", done, closed);
}

let healthEntry;

async function renderHealth() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { health = {} } = await chrome.storage.session.get("health");
  const entry = tab ? health[tab.id] : null;
  healthEntry = entry || null;
  $("report").href = reportLink(entry);
  const node = $("health");
  node.hidden = !entry || isPausedNow();
  if (!entry) return;
  if (!entry.missing.length) {
    node.className = "ok";
    node.textContent = t("healthOk");
    return;
  }
  node.className = "warn";
  const names = entry.missing.map((key) => (HEALTH_KEYS[key] ? t(HEALTH_KEYS[key]) : key));
  const link = el("a", { href: reportLink(entry), target: "_blank", rel: "noopener" }, t("reportThis"));
  const known = el("a", { href: L.BREAKAGE_URL, target: "_blank", rel: "noopener" }, t("breakageLink"));
  node.replaceChildren(t("healthBroken", new Intl.ListFormat(LANG).format(names)), " ", link, " · ", known);
}

function browserLabel() {
  const brands = navigator.userAgentData?.brands?.filter((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) ?? [];
  const brand = brands[0] ? `${brands[0].brand} ${brands[0].version}` : (navigator.userAgent.match(/(Firefox|Edg|OPR|YaBrowser|Chrome)\/[\d]+/)?.[0] ?? "");
  return `${brand} / ${LANG}`;
}

let diagnosticsLog = [];

function reportLink(entry) {
  const missing = entry?.missing ?? [];
  return L.reportUrl({
    version: chrome.runtime.getManifest().version,
    browser: browserLabel(),
    page: entry?.page ?? "",
    missing: [missing.join(", ") || "-", L.formatDiagnostics(diagnosticsLog, settings)],
  });
}

function renderForm() {
  for (const [container, keys] of [["hide", HIDE_KEYS], ["more", MORE_KEYS]]) {
    const host = $(container);
    host.replaceChildren();
    for (const [key, label] of keys) {
      const box = el("input", { type: "checkbox", checked: Boolean(settings.hide[key]) });
      box.addEventListener("change", () => save({ hide: { [key]: box.checked } }));
      host.append(el("label", { class: "row" }, el("span", {}, t(label)), box));
    }
  }

  for (const key of ["stopAutoplay", "endPrompt"]) {
    $(key).checked = Boolean(settings[key]);
    $(key).addEventListener("change", () => save({ [key]: $(key).checked }));
  }

  for (const key of ["homeTarget", "shortsMode", "mode", "strictStart", "strictEnd"]) {
    $(key).value = settings[key];
    $(key).addEventListener("change", () => {
      const patch = { [key]: $(key).value };
      if (key === "mode") pickedAuto = patch.mode === "auto";
      save(patch);
      $(key).value = settings[key];
    });
  }

  const days = $("days");
  days.replaceChildren();
  for (const day of weekdayOrder()) {
    const box = el("input", { type: "checkbox", checked: settings.strictDays.includes(day) });
    box.addEventListener("change", () => {
      const set = new Set(settings.strictDays);
      if (box.checked) set.add(day);
      else set.delete(day);
      save({ strictDays: [...set] });
    });
    box.setAttribute("aria-label", weekdayName(day, "long"));
    days.append(el("label", { title: weekdayName(day, "long") }, box, weekdayName(day, "narrow")));
  }
}

function setupLinks() {
  $("rate").href = `${L.STORE_URL}/reviews`;
  const copy = $("copyLink");
  copy.href = L.STORE_URL;
  let timer = 0;
  copy.addEventListener("click", (event) => {
    event.preventDefault();
    navigator.clipboard.writeText(L.STORE_URL).then(
      () => {
        copy.textContent = t("copied");
        clearTimeout(timer);
        timer = setTimeout(() => {
          copy.textContent = t("copyLink");
        }, 2000);
      },
      () => chrome.tabs.create({ url: L.STORE_URL }),
    );
  });
}

function setupBackup() {
  $("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ errand: 1, settings }, null, 2)], { type: "application/json" });
    const link = el("a", { href: URL.createObjectURL(blob), download: "errand-settings.json" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const firefoxPopup = typeof globalThis.browser !== "undefined" && !location.search.includes("tab");
  if (firefoxPopup) {
    $("import").closest("label").addEventListener("click", (event) => {
      event.preventDefault();
      if ($("import").disabled) return;
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?tab") });
    });
  }
  $("import").addEventListener("change", async () => {
    const file = $("import").files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      settings = L.mergeSettings(data.settings || data);
      await chrome.storage.local.set({ settings });
      location.reload();
    } catch {
      $("status").textContent = t("importFailed");
    }
  });
}

async function init() {
  localize();
  const data = await chrome.storage.local.get(["settings", "stats", "log", "pausedUntil", "pauseStartsAt", "strictOffAt"]);
  diagnosticsLog = data.log || [];
  settings = L.mergeSettings(data.settings);
  pausedUntil = data.pausedUntil ?? null;
  pauseStartsAt = data.pauseStartsAt ?? null;
  strictOffAt = data.strictOffAt ?? null;
  $("lookAgain").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });
  if (data.pausedUntil !== undefined && !L.isPaused(data.pausedUntil, Date.now())) {
    chrome.storage.local.remove("pausedUntil");
    pausedUntil = null;
  }
  chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  $("pauseButton").addEventListener("click", onPauseClick);
  $("strictOff").addEventListener("click", onStrictOffClick);
  renderForm();
  setupBackup();
  setupLinks();
  renderStatus();
  renderStats(data.stats || {});
  await renderHealth();
}

init();
