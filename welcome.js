const L = globalThis.ErrandLib;
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

let settings = L.mergeSettings();
const PIN_KEYS = { default: "welcomePin", edge: "welcomePin", opera: "welcomePinOpera", yandex: "welcomePinYandex", any: "welcomePinAny" };

function pinStep() {
  try {
    const key = PIN_KEYS[L.browserHint(navigator, getComputedStyle(document.documentElement))];
    if (key && t(key)) document.getElementById("pin").dataset.i18n = key;
  } catch {}
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.documentElement.dir = t("@@bidi_dir");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
}

function renderLines(id) {
  const list = document.getElementById("lines");
  list.replaceChildren(
    ...L.welcomeLines(id).map((key) => {
      const item = document.createElement("li");
      item.textContent = t(key);
      return item;
    }),
  );
}

async function init() {
  pinStep();
  localize();
  const data = await chrome.storage.local.get("settings");
  settings = L.mergeSettings(data.settings);
  const current = L.presetOf(settings);
  for (const radio of document.querySelectorAll('input[name="preset"]')) {
    radio.checked = radio.value === current;
    radio.addEventListener("change", async () => {
      const fresh = await chrome.storage.local.get("settings");
      settings = L.applyPreset(L.mergeSettings(fresh.settings), radio.value);
      await chrome.storage.local.set({ settings });
      renderLines(radio.value);
    });
  }
  renderLines(current || "ask");
}

init();
