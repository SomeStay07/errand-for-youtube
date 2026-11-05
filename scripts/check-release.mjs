import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
