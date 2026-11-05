const L = globalThis.ErrandLib;
const t = L.translator(chrome.i18n);

const PIN_KEYS = { default: "welcomePin", edge: "welcomePin", opera: "welcomePinOpera", yandex: "welcomePinYandex", any: "welcomePinAny" };

function pinStep() {
  try {
    const key = PIN_KEYS[L.browserHint(navigator, getComputedStyle(document.documentElement))];
    if (key && t(key)) document.getElementById("pin").dataset.i18n = key;
  } catch {}
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
  L.localizeDocument(document, t, chrome.i18n.getUILanguage());
  const data = await chrome.storage.local.get("settings");
  const current = L.presetOf(data.settings);
  for (const radio of document.querySelectorAll('input[name="preset"]')) {
    radio.checked = radio.value === current;
    radio.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({ type: "preset", id: radio.value }).catch(async () => {
        const fresh = await chrome.storage.local.get("settings");
        await chrome.storage.local.set({ settings: L.applyPreset(L.mergeSettings(fresh.settings), radio.value) });
      });
      renderLines(radio.value);
    });
  }
  renderLines(current || "ask");
}

init();
