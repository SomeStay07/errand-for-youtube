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

function save() {
  chrome.storage.local.set({ settings });
  renderStatus();
}

function renderStatus() {
  let text = t("statusNormal");
  if (settings.mode === "strict") text = t("statusStrictAlways");
  else if (L.isStrict(settings, new Date())) text = t("statusStrictUntil", settings.strictEnd);
  $("status").textContent = text;
  $("schedule").hidden = settings.mode !== "auto";
}

function renderStats(stats) {
  let intended = 0;
  let drift = 0;
  for (const key of L.lastDays(7, new Date())) {
    intended += stats[key]?.intended || 0;
    drift += stats[key]?.drift || 0;
  }
  const total = intended + drift;
  $("summary").textContent = total ? t("summary", total, Math.round((drift / total) * 100)) : t("summaryEmpty");
}

async function renderHealth() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { health = {} } = await chrome.storage.session.get("health");
  const entry = tab ? health[tab.id] : null;
  $("report").href = reportLink(entry);
  const node = $("health");
  if (!entry) {
    node.className = "hint";
    node.textContent = t("healthOpenTab");
    return;
  }
  if (!entry.missing.length) {
    node.className = "ok";
    node.textContent = t("healthOk");
    return;
  }
  node.className = "warn";
  const names = entry.missing.map((key) => (HEALTH_KEYS[key] ? t(HEALTH_KEYS[key]) : key));
  const link = el("a", { href: reportLink(entry), target: "_blank", rel: "noopener" }, t("reportThis"));
  node.replaceChildren(t("healthBroken", new Intl.ListFormat(LANG).format(names)), " ", link);
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
      box.addEventListener("change", () => {
        settings.hide = { ...settings.hide, [key]: box.checked };
        save();
      });
      host.append(el("label", { class: "row" }, el("span", {}, t(label)), box));
    }
  }

  for (const key of ["stopAutoplay", "endPrompt"]) {
    $(key).checked = Boolean(settings[key]);
    $(key).addEventListener("change", () => {
      settings[key] = $(key).checked;
      save();
    });
  }

  for (const key of ["homeTarget", "shortsMode", "mode", "strictStart", "strictEnd"]) {
    $(key).value = settings[key];
    $(key).addEventListener("change", () => {
      settings[key] = $(key).value;
      save();
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
      settings.strictDays = [...set];
      save();
    });
    days.append(el("label", { title: weekdayName(day, "long") }, box, weekdayName(day, "narrow")));
  }
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
  const data = await chrome.storage.local.get(["settings", "stats", "log"]);
  diagnosticsLog = data.log || [];
  settings = L.mergeSettings(data.settings);
  renderForm();
  setupBackup();
  renderStatus();
  renderStats(data.stats || {});
  await renderHealth();
}

init();
