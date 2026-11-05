const L = globalThis.ErrandLib;
const t = L.translator(chrome.i18n);
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

const state = {
  settings: L.mergeSettings(),
  pausedUntil: null,
  pauseStartsAt: null,
  strictOffAt: null,
  pickedAuto: false,
  lastStrict: false,
  editedSchedule: false,
  pauseCounting: false,
  strictCounting: false,
  savesInFlight: 0,
  health: undefined,
  updateNote: undefined,
  noteShown: false,
  log: [],
};
let renderTimer = 0;

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

function announce(text) {
  $("announce").textContent = text;
}

function save(patch) {
  state.editedSchedule = ["mode", "strictStart", "strictEnd", "strictDays"].some((key) => key in patch);
  state.settings = L.patchSettings(state.settings, patch);
  render();
  state.savesInFlight++;
  chrome.runtime
    .sendMessage({ type: "patch", patch })
    .catch(async () => {
      const { settings: stored } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: L.patchSettings(stored, patch) });
    })
    .finally(() => {
      state.savesInFlight--;
      resyncSchedule();
    });
}

async function resyncSchedule() {
  if (state.savesInFlight) return;
  const { settings: stored } = await chrome.storage.local.get("settings");
  if (state.savesInFlight || !stored) return;
  const next = L.mergeSettings(stored);
  for (const key of ["mode", "strictStart", "strictEnd", "strictDays", "strictSkipUntil"]) state.settings[key] = next[key];
  for (const key of ["mode", "strictStart", "strictEnd"]) $(key).value = state.settings[key];
  const boxes = $("days").querySelectorAll("input");
  weekdayOrder().forEach((day, i) => {
    if (boxes[i]) boxes[i].checked = state.settings.strictDays.includes(day);
  });
  render();
}

function view() {
  const now = new Date();
  const strict = L.isStrict(state.settings, now);
  return { now, strict, paused: !strict && L.isPaused(state.pausedUntil, now.getTime()) };
}

function render() {
  const v = view();
  clearTimeout(renderTimer);
  renderStatus(v);
  const pauseCounting = renderPause(v);
  const strictCounting = renderStrictLock(v);
  if (pauseCounting || strictCounting) renderTimer = setTimeout(render, 250);
  else if (state.settings.mode === "auto") renderTimer = setTimeout(render, 60_000 - (Date.now() % 60_000) + 50);
}

function renderStatus({ strict, paused }) {
  const { settings } = state;
  let text = t("statusNormal");
  if (settings.mode === "strict") text = t("statusStrictAlways");
  else if (strict) text = t("statusStrictUntil", L.clockOf(settings.strictEnd, LANG));
  else if (paused) text = t("statusPaused", L.clock(state.pausedUntil, LANG));
  if ($("status").textContent !== text) $("status").textContent = text;
  $("schedule").hidden = settings.mode !== "auto";
  if (state.health !== undefined) $("health").hidden = paused || (!state.health && !state.noteShown);
}

function renderPause({ now, strict, paused }) {
  const row = $("pause");
  const button = $("pauseButton");
  const wasCounting = state.pauseCounting;
  state.pauseCounting = false;
  if (strict) {
    row.hidden = true;
    return false;
  }
  row.hidden = false;
  if (L.isPauseStarting(state.pauseStartsAt, now.getTime())) {
    button.textContent = t("pauseCountdown", Math.max(1, Math.ceil((state.pauseStartsAt - Date.now()) / 1000)));
    if (!wasCounting) announce(button.textContent);
    state.pauseCounting = true;
    return true;
  }
  button.textContent = paused ? t("resumeButton") : t("pauseButton");
  return false;
}

function renderStrictLock({ now, strict }) {
  const { settings } = state;
  if (settings.mode !== "auto" || (strict && !state.lastStrict && !state.editedSchedule)) state.pickedAuto = false;
  state.lastStrict = strict;
  state.editedSchedule = false;
  const locked = strict && !state.pickedAuto;
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
  const hadFocus = document.activeElement === button;
  button.hidden = !locked;
  if (hadFocus && !locked && !$("pause").hidden) $("pauseButton").focus();
  if (locked && L.strictExit(settings, state.strictOffAt, now) === "waiting") {
    button.textContent = t("strictOffCountdown", Math.max(1, Math.ceil((state.strictOffAt - Date.now()) / 1000)));
    if (!state.strictCounting) announce(button.textContent);
    state.strictCounting = true;
    return true;
  }
  state.strictCounting = false;
  button.textContent = settings.mode === "auto" ? t("strictOffUntil", L.clockOf(settings.strictEnd, LANG)) : t("strictOffButton");
  return false;
}

function onStrictOffClick() {
  const now = new Date();
  if (L.strictExit(state.settings, state.strictOffAt, now) === "waiting") {
    chrome.storage.local.remove("strictOffAt");
    state.strictOffAt = null;
  } else if (L.isStrict(state.settings, now)) {
    state.strictOffAt = Date.now() + L.PAUSE_WAIT_S * 1000;
    chrome.storage.local.set({ strictOffAt: state.strictOffAt });
  }
  render();
}

function onPauseClick() {
  const { now, paused } = view();
  if (paused) {
    chrome.storage.local.remove("pausedUntil");
    state.pausedUntil = null;
  } else if (L.isPauseStarting(state.pauseStartsAt, now.getTime())) {
    chrome.storage.local.remove("pauseStartsAt");
    state.pauseStartsAt = null;
  } else if (L.canPause(state.settings, now, state.pausedUntil)) {
    state.pauseStartsAt = Date.now() + L.PAUSE_WAIT_S * 1000;
    chrome.storage.local.set({ pauseStartsAt: state.pauseStartsAt });
  }
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.pausedUntil) state.pausedUntil = changes.pausedUntil.newValue ?? null;
  if (changes.pauseStartsAt) state.pauseStartsAt = changes.pauseStartsAt.newValue ?? null;
  if (changes.strictOffAt) state.strictOffAt = changes.strictOffAt.newValue ?? null;
  if (changes.settings?.newValue) resyncSchedule();
  if (changes.pausedUntil || changes.pauseStartsAt || changes.strictOffAt) render();
});

function renderStats(stats) {
  const { done, closed } = L.errandTotals(stats, new Date());
  $("week").hidden = done === 0;
  if (done) $("summary").textContent = t("errandsSummary", done, closed);
}

function renderRate(stats, rateNote, flags) {
  if (!L.shouldShowRate(stats, rateNote, new Date(), flags)) return;
  const shown = (Number(rateNote?.shown) || 0) + 1;
  chrome.storage.local.set({ rateNote: { shown, done: false } });
  const finish = () => chrome.storage.local.set({ rateNote: { shown, done: true } });
  const hint = $("weekHint");
  const link = el("a", { href: `${L.STORE_URL}/reviews`, target: "_blank", rel: "noopener" }, t("rateErrand"));
  link.addEventListener("click", finish);
  const close = el("button", { type: "button", class: "dismiss", "aria-label": t("noteDismiss"), title: t("noteDismiss") }, "×");
  close.addEventListener("click", () => {
    finish();
    hint.textContent = t("errandsHint");
    hint.tabIndex = -1;
    hint.focus();
  });
  hint.replaceChildren(t("noteRate"), " ", link, " ", close);
}

function renderUpdateNote(node) {
  const note = state.updateNote;
  chrome.storage.local.set({ updateNote: { ...note, shown: (Number(note.shown) || 0) + 1 } });
  const link = el("a", { href: L.changesUrl(note.version), target: "_blank", rel: "noopener" }, t("noteUpdatedLink"));
  link.addEventListener("click", () => chrome.storage.local.remove("updateNote"));
  node.className = "";
  node.replaceChildren(t("noteUpdated", note.version), " ", link);
}

async function renderHealth() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { health = {} } = await chrome.storage.session.get("health");
  const entry = (tab && health[tab.id]) || null;
  const { paused } = view();
  state.health = entry;
  $("report").href = reportLink(entry);
  const node = $("health");
  state.noteShown = L.shouldShowUpdateNote(state.updateNote, { warn: Boolean(entry?.missing.length), paused });
  node.hidden = paused || (!entry && !state.noteShown);
  if (state.noteShown) {
    renderUpdateNote(node);
    return;
  }
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

function reportLink(entry) {
  const missing = entry?.missing ?? [];
  return L.reportUrl({
    version: chrome.runtime.getManifest().version,
    browser: L.browserLabel(navigator, LANG),
    page: entry?.page ?? "",
    missing: [missing.join(", ") || "-", L.formatDiagnostics(state.log, state.settings)],
  });
}

function renderForm() {
  const { settings } = state;
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
      if (key === "mode") state.pickedAuto = patch.mode === "auto";
      save(patch);
      $(key).value = state.settings[key];
    });
  }

  const days = $("days");
  days.replaceChildren();
  for (const day of weekdayOrder()) {
    const box = el("input", { type: "checkbox", checked: settings.strictDays.includes(day) });
    box.addEventListener("change", () => {
      const set = new Set(state.settings.strictDays);
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
    const blob = new Blob([JSON.stringify({ errand: 1, settings: state.settings }, null, 2)], { type: "application/json" });
    const link = el("a", { href: URL.createObjectURL(blob), download: "errand-settings.json" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  const firefoxPopup = L.isFirefox(globalThis) && !location.search.includes("tab");
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
      if (data?.errand !== 1 || !data.settings || typeof data.settings !== "object" || Array.isArray(data.settings)) throw new Error();
      const next = L.mergeSettings(data.settings);
      await chrome.runtime.sendMessage({ type: "replace", settings: next }).catch(() => chrome.storage.local.set({ settings: next }));
      location.reload();
    } catch {
      $("status").textContent = t("importFailed");
    }
  });
}

async function init() {
  L.localizeDocument(document, t, LANG);
  const keys = ["settings", "stats", "log", "pausedUntil", "pauseStartsAt", "strictOffAt", "updateNote", "rateNote"];
  const data = await chrome.storage.local.get(keys);
  state.log = data.log || [];
  state.updateNote = data.updateNote;
  state.settings = L.mergeSettings(data.settings);
  state.pausedUntil = L.isPaused(data.pausedUntil, Date.now()) ? data.pausedUntil : null;
  state.pauseStartsAt = data.pauseStartsAt ?? null;
  state.strictOffAt = data.strictOffAt ?? null;
  $("lookAgain").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });
  chrome.runtime.sendMessage({ type: "sync" }).catch(() => {});
  $("pauseButton").addEventListener("click", onPauseClick);
  $("strictOff").addEventListener("click", onStrictOffClick);
  renderForm();
  setupBackup();
  setupLinks();
  render();
  renderStats(data.stats || {});
  await renderHealth();
  renderRate(data.stats || {}, data.rateNote, { warn: Boolean(state.health?.missing.length), noteShown: state.noteShown });
}

init();
