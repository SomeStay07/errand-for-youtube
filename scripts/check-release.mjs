import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const L = createRequire(import.meta.url)("../lib.js");
const OFFLINE = process.argv.includes("--offline") || process.env.CHECK_RELEASE_OFFLINE === "1";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const walk = (dir) => readdirSync(join(ROOT, dir), { recursive: true }).map((f) => join(dir, String(f)));
const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`FAIL ${msg}`);
};
const pass = (msg) => console.log(`PASS ${msg}`);
const warn = (msg) => console.log(`WARN ${msg}`);
const info = (msg) => console.log(`INFO ${msg}`);

const version = JSON.parse(read("manifest.json")).version;
const versions = { "manifest.json": version, "package.json": JSON.parse(read("package.json")).version };
for (const file of walk("docs").filter((f) => f.endsWith(".html"))) {
  for (const m of read(file).matchAll(/"softwareVersion":\s*"([^"]+)"/g)) versions[file] = m[1];
}
const off = Object.entries(versions).filter(([, v]) => v !== version);
if (off.length) fail(`version ${version} in manifest.json, but ${off.map(([f, v]) => `${f}=${v}`).join(", ")}`);
else pass(`version ${version} in ${Object.keys(versions).join(", ")}`);

const STORE_URL = /STORE_URL\s*=\s*"([^"]+)"/.exec(read("lib.js"))?.[1];
if (!STORE_URL) fail("STORE_URL not found in lib.js");
else {
  const bad = [];
  let checked = 0;
  for (const file of walk("docs").filter((f) => f.endsWith(".html"))) {
    for (const m of read(file).matchAll(/<a class="button primary" href="([^"]+)"[^>]*>([^<]*)</g)) {
      if (m[1].includes("docs.google.com/forms")) continue;
      checked++;
      if (m[1] !== STORE_URL) bad.push(`${file}: "${m[2]}" → ${m[1]}`);
    }
  }
  for (const m of read("README.md").matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    if (!/chrome web store|install|установить/i.test(m[1])) continue;
    checked++;
    if (m[2] !== STORE_URL) bad.push(`README.md: "${m[1]}" → ${m[2]}`);
  }
  if (bad.length) bad.forEach((b) => fail(`install link not STORE_URL: ${b}`));
  else if (!checked) fail("no install buttons found in docs/ or README.md");
  else pass(`${checked} install links point to ${STORE_URL}`);
}

const strayTiles = walk("store/images").filter((f) => /(^|\/)promo-[^/]*$/.test(f) && !f.startsWith(join("store", "images", "en") + "/"));
if (strayTiles.length) fail(`promo tiles outside store/images/en/: ${strayTiles.join(", ")}`);
else pass("promo tiles only in store/images/en/");

const UI = ["popup.html", "popup.css", "popup.js", "welcome.html", "welcome.css", "welcome.js", "content.js", "hide.css"];
const tag = git("describe", "--tags", "--abbrev=0");
const since = tag ? [`${tag}..HEAD`] : [];
const changed = new Set([...git("diff", "--name-only", ...since, "--", ...UI).split("\n"), ...git("diff", "--name-only", "HEAD", "--", ...UI).split("\n")].filter(Boolean));
if (!changed.size) pass(`no UI files changed since ${tag || "the first commit"}`);
else {
  const dirty = git("status", "--porcelain", "--", ...UI);
  const uiTime = dirty ? Math.floor(Date.now() / 1000) : Number(git("log", "-1", "--format=%ct", ...since, "--", ...changed));
  const shotsTime = Number(git("log", "-1", "--format=%ct", "--", "store/shots")) || 0;
  if (shotsTime >= uiTime) pass(`store/shots newer than changed UI files (${[...changed].join(", ")})`);
  else warn(`UI changed since ${tag || "start"} (${[...changed].join(", ")}) after the last store/shots commit; recapture screenshots if the change is visible`);
}

const [major, minor] = version.split(".");
const anchor = `id="v${major}.${minor}"`;
const changesPages = Object.values(L.CHANGES_PATHS).map((path) => [path, `docs${path}index.html`]);
const localOff = changesPages.flatMap(([, file]) => (!existsSync(join(ROOT, file)) ? [`${file} missing`] : read(file).includes(anchor) ? [] : [`${file} has no ${anchor}`]));
if (localOff.length) fail(`changes pages: ${localOff.join("; ")}: the update note for ${version} would link to a missing page or anchor`);
else pass(`all ${changesPages.length} changes pages have the #v${major}.${minor} anchor the update note links to`);
if (OFFLINE) info(`live changes pages NOT checked (--offline / CHECK_RELEASE_OFFLINE=1): check ${changesPages.length} URLs under ${L.SITE_URL} before submitting to the store`);
else {
  const liveOff = await Promise.all(
    changesPages.map(async ([path]) => {
      const url = `${L.SITE_URL}${path}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
        if (res.status !== 200) return `${url} HTTP ${res.status}`;
        return (await res.text()).includes(anchor) ? null : `${url} has no ${anchor}`;
      } catch (e) {
        return `${url} unreachable (${e.name})`;
      }
    }),
  );
  const bad = liveOff.filter(Boolean);
  if (bad.length) fail(`live changes pages: ${bad.join("; ")}: push the site before submitting to the store`);
  else pass(`live changes pages: ${changesPages.length} URLs return 200 with ${anchor}`);
}

const DIST = join(ROOT, "dist/chrome");
const BUILD_FILES = [...(/const FILES = \[([^\]]*)\]/.exec(read("scripts/build.mjs"))?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const files = (rel) => {
  const full = join(ROOT, rel);
  if (!existsSync(full)) return [];
  return statSync(full).isDirectory() ? readdirSync(full, { recursive: true }).map((f) => join(rel, String(f))).filter((f) => statSync(join(ROOT, f)).isFile() && !f.endsWith(".DS_Store")) : [rel];
};
const digest = (path, rel) => {
  const raw = readFileSync(path);
  return createHash("sha256").update(rel.endsWith(".json") ? JSON.stringify(JSON.parse(raw)) : raw).digest("hex");
};
if (!BUILD_FILES.length) fail("FILES list not found in scripts/build.mjs");
else if (!existsSync(DIST)) fail("dist/chrome missing: run npm run build");
else {
  const stale = BUILD_FILES.flatMap(files).filter((rel) => !existsSync(join(DIST, rel)) || digest(join(ROOT, rel), rel) !== digest(join(DIST, rel), rel));
  if (stale.length) fail(`dist/chrome differs from the sources (${stale.join(", ")}): run npm run build before packing`);
  else pass(`dist/chrome matches the sources (${BUILD_FILES.flatMap(files).length} files)`);
  const built = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  const refs = new Set([`_locales/${built.default_locale}/messages.json`]);
  const add = (v) => (typeof v === "string" ? refs.add(v) : Array.isArray(v) ? v.forEach(add) : v && typeof v === "object" ? Object.values(v).forEach(add) : null);
  add([built.icons, built.action?.default_icon, built.action?.default_popup, built.background?.service_worker, built.background?.scripts, built.options_page, built.options_ui?.page]);
  for (const cs of built.content_scripts || []) add([cs.js, cs.css]);
  for (const w of built.web_accessible_resources || []) add(w.resources);
  for (const html of readdirSync(DIST).filter((f) => f.endsWith(".html"))) for (const [, ref] of readFileSync(join(DIST, html), "utf8").matchAll(/(?:src|href)="([^"]+)"/g)) refs.add(ref);
  const missing = [...refs].map((r) => r.split(/[?#]/)[0]).filter((r) => r && !/^[a-z]+:|^\/\//i.test(r) && !existsSync(join(DIST, r)));
  if (missing.length) fail(`dist/chrome references files it does not ship: ${missing.join(", ")}`);
  else pass(`every manifest path and HTML src/href in dist/chrome is shipped (${refs.size})`);
  const zip = join(ROOT, "dist", `errand-chrome-${version}.zip`);
  if (!existsSync(zip)) fail(`dist/errand-chrome-${version}.zip missing`);
  else {
    const entries = execFileSync("unzip", ["-Z1", zip]).toString().split("\n").filter(Boolean);
    const dot = entries.filter((e) => e.split("/").some((part) => part.startsWith(".")));
    const zipped = new Set(entries.filter((e) => !e.endsWith("/")));
    const absent = BUILD_FILES.flatMap(files).filter((rel) => !zipped.has(rel));
    if (dot.length || absent.length) fail(`zip ${dot.length ? `ships hidden files (${dot.join(", ")})` : ""}${absent.length ? ` misses ${absent.join(", ")}` : ""}`);
    else if (statSync(zip).mtimeMs < statSync(join(DIST, "manifest.json")).mtimeMs - 5000) fail("zip is older than dist/chrome: run npm run build");
    else pass(`zip has ${zipped.size} files, no hidden files`);
  }
}

const roadmap = join(ROOT, "notes/roadmap.md");
if (!existsSync(roadmap)) info("notes/roadmap.md not present (private notes), Status not checked");
else {
  const text = readFileSync(roadmap, "utf8");
  const status = text.slice(text.indexOf("## Status"), text.indexOf("\n## ", text.indexOf("## Status") + 1));
  if (status.includes(version)) pass(`roadmap Status mentions ${version}`);
  else fail(`roadmap Status does not mention ${version} (${relative(ROOT, roadmap)})`);
}

const id = /detail\/(?:[^/]+\/)?([a-p]{32})/.exec(STORE_URL || "")?.[1];
if (id) {
  try {
    const url = `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=130&acceptformat=crx3&x=id%3D${id}%26uc`;
    const xml = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).text();
    const store = /<updatecheck[^>]*\sversion="([^"]+)"/.exec(xml)?.[1];
    if (!store) info("store version: not in update2 response");
    else info(`store serves ${store}, repo is ${version}${store === version ? "" : " (not uploaded or still in review)"}`);
  } catch (e) {
    info(`store version: update2 unreachable (${e.name})`);
  }
}

console.log(failed ? `check:release: ${failed} failed` : "check:release: ok");
process.exitCode = failed ? 1 : 0;
