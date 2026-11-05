const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const locales = fs.readdirSync(path.join(root, "_locales"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const messages = Object.fromEntries(
  locales.map((loc) => [loc, JSON.parse(read(`_locales/${loc}/messages.json`))]),
);

function usedKeys() {
  const keys = new Set();
  for (const file of ["content.js", "popup.js", "welcome.js", "background.js"]) {
    for (const match of read(file).matchAll(/\bt\("(\w+)"/g)) keys.add(match[1]);
  }
  for (const match of read("popup.html").matchAll(/data-i18n="(\w+)"/g)) keys.add(match[1]);
  for (const match of read("welcome.html").matchAll(/data-i18n="(\w+)"/g)) keys.add(match[1]);
  for (const match of read("lib.js").matchAll(/"(welcome\w+)"/g)) keys.add(match[1]);
  for (const match of read("popup.js").matchAll(/\["\w+", "(hide\w+)"\]/g)) keys.add(match[1]);
  for (const match of read("popup.js").matchAll(/: "(health\w+)"/g)) keys.add(match[1]);
  for (const match of read("manifest.json").matchAll(/__MSG_(\w+)__/g)) keys.add(match[1]);
  keys.add("extNameShort");
  return keys;
}

test("every used key exists in every locale", () => {
  for (const key of usedKeys()) {
    for (const loc of locales) assert.ok(messages[loc][key], `${loc} is missing ${key}`);
  }
});

test("all locales have the same keys and placeholders", () => {
  const base = messages.en;
  for (const loc of locales) {
    assert.deepEqual(Object.keys(messages[loc]).sort(), Object.keys(base).sort(), loc);
    for (const [key, value] of Object.entries(base)) {
      const names = Object.keys(value.placeholders || {}).sort();
      assert.deepEqual(Object.keys(messages[loc][key].placeholders || {}).sort(), names, `${loc}.${key}`);
      for (const name of names) assert.ok(messages[loc][key].message.includes(`$${name.toUpperCase()}$`), `${loc}.${key} uses $${name}$`);
    }
  }
});

test("store limits: name <= 75, short name <= 45, description <= 132 characters", () => {
  for (const loc of locales) {
    assert.ok(messages[loc].extName.message.length <= 75, `${loc} name`);
    assert.ok(messages[loc].extNameShort.message.length <= 45, `${loc} short name`);
    assert.ok(messages[loc].extDescription.message.length <= 132, `${loc} description`);
  }
});

function keyMap(file, name) {
  const body = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`).exec(read(file));
  assert.ok(body, `${file} defines ${name}`);
  return Object.fromEntries([...body[1].matchAll(/(\w+): "(\w+)"/g)].map(([, from, to]) => [from, to]));
}

const L = require("../lib.js");
const hasText = (loc, key) => typeof messages[loc][key]?.message === "string" && messages[loc][key].message.trim() !== "";

test("every browser hint has a home footnote and a welcome pin step in every locale", () => {
  for (const [file, name] of [["content.js", "FOOTER_KEYS"], ["welcome.js", "PIN_KEYS"]]) {
    const map = keyMap(file, name);
    for (const hint of L.BROWSER_HINTS) {
      assert.ok(map[hint], `${name} has ${hint}`);
      for (const loc of locales) assert.ok(hasText(loc, map[hint]), `${loc} ${map[hint]}`);
    }
  }
});

test("every health and leak name has a popup label in every locale", () => {
  const map = keyMap("popup.js", "HEALTH_KEYS");
  const names = new Set(["shorts"]);
  for (const checks of [...Object.values(L.HEALTH), ...Object.values(L.LEAKS)]) for (const [name] of checks) names.add(name);
  for (const name of names) {
    assert.ok(map[name], `HEALTH_KEYS has ${name}`);
    for (const loc of locales) assert.ok(hasText(loc, map[name]), `${loc} ${map[name]}`);
  }
});
