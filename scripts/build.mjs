import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.DIST || join(ROOT, "dist");
const FILES = [
  "manifest.json",
  "lib.js",
  "content.js",
  "background.js",
  "hide.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "welcome.html",
  "welcome.css",
  "welcome.js",
  "icons",
  "_locales",
];
const GECKO_ID = "errand-for-youtube@timurceberda";

const base = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

function shortName(manifest) {
  return { ...manifest, name: "__MSG_extNameShort__" };
}

function firefox(manifest) {
  const { minimum_chrome_version, ...rest } = shortName(manifest);
  return {
    ...rest,
    background: { scripts: ["lib.js", "background.js"] },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["none"] },
      },
    },
  };
}

const TARGETS = {
  chrome: (m) => m,
  edge: shortName,
  opera: (m) => m,
  firefox,
};

const only = process.argv.length > 2 ? process.argv.slice(2) : ["chrome"];
rmSync(DIST, { recursive: true, force: true });

for (const [name, transform] of Object.entries(TARGETS)) {
  if (only.length && !only.includes(name)) continue;
  const out = join(DIST, name);
  mkdirSync(out, { recursive: true });
  for (const file of FILES) cpSync(join(ROOT, file), join(out, file), { recursive: true });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(transform(base), null, 2)}\n`);
  const zip = join(DIST, `errand-${name}-${base.version}.zip`);
  execFileSync("zip", ["-qrX", zip, "."], { cwd: out });
  console.log(`${name}: ${zip}`);
}
