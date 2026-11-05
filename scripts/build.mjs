import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
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

function referencedFiles(manifest, out) {
  const refs = new Set([`_locales/${manifest.default_locale}/messages.json`]);
  const add = (value) => {
    if (typeof value === "string") refs.add(value);
    else if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === "object") Object.values(value).forEach(add);
  };
  add(manifest.icons);
  add(manifest.action?.default_icon);
  add(manifest.action?.default_popup);
  add(manifest.background?.service_worker);
  add(manifest.background?.scripts);
  add(manifest.options_page);
  add(manifest.options_ui?.page);
  for (const script of manifest.content_scripts || []) add([script.js, script.css]);
  for (const entry of manifest.web_accessible_resources || []) add(entry.resources);
  for (const file of readdirSync(out).filter((f) => /\.(html|js)$/.test(f))) {
    const text = readFileSync(join(out, file), "utf8");
    const pattern = file.endsWith(".html") ? /(?:src|href)="([^"]+)"/g : /(?:importScripts|getURL)\("([^"]+)"\)/g;
    for (const [, ref] of text.matchAll(pattern)) refs.add(ref);
  }
  return [...refs].map((ref) => ref.split(/[?#]/)[0]).filter((ref) => ref && !/^[a-z]+:|^\/\//i.test(ref));
}

const only = process.argv.length > 2 ? process.argv.slice(2) : ["chrome"];
const unknown = only.filter((name) => !TARGETS[name]);
if (unknown.length) throw new Error(`unknown target: ${unknown.join(", ")}`);

for (const [name, transform] of Object.entries(TARGETS)) {
  if (!only.includes(name)) continue;
  const out = join(DIST, name);
  const zip = join(DIST, `errand-${name}-${base.version}.zip`);
  rmSync(out, { recursive: true, force: true });
  const stale = existsSync(DIST) ? readdirSync(DIST).filter((f) => f.startsWith(`errand-${name}-`) && f.endsWith(".zip")) : [];
  for (const file of stale) rmSync(join(DIST, file), { force: true });
  mkdirSync(out, { recursive: true });
  for (const file of FILES) {
    cpSync(join(ROOT, file), join(out, file), { recursive: true, filter: (src) => basename(src) !== ".DS_Store" });
  }
  const manifest = transform(base);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const missing = referencedFiles(manifest, out).filter((ref) => !existsSync(join(out, ref)));
  if (missing.length) throw new Error(`${name}: referenced but not shipped: ${missing.join(", ")}`);
  execFileSync("zip", ["-qrX", zip, ".", "-x", "*.DS_Store"], { cwd: out });
  console.log(`${name}: ${zip}`);
}
