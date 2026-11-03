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
  for (const file of ["content.js", "popup.js"]) {
    for (const match of read(file).matchAll(/\bt\("(\w+)"/g)) keys.add(match[1]);
  }
  for (const match of read("popup.html").matchAll(/data-i18n="(\w+)"/g)) keys.add(match[1]);
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
