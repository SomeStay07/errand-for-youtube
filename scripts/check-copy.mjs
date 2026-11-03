import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(ROOT, ".claude", "text-gate", "check-text.mjs");
if (!existsSync(GATE)) {
  console.log("check:copy skipped: .claude/text-gate is not present on this machine");
  process.exit(0);
}

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n+/g, "\n");

const listing = readFileSync(join(ROOT, "store/listing/ru.md"), "utf8").split(/\n## [^\n]*\n/)[1] || "";
const captions = JSON.parse(readFileSync(join(ROOT, "store/captions.json"), "utf8")).ru;
const messages = JSON.parse(readFileSync(join(ROOT, "_locales/ru/messages.json"), "utf8"));
const sources = {
  "store/listing/ru.md": listing,
  "store/captions.json (ru)": [captions.tagline.replace(/<br>/g, " "), ...captions.screens.map(([, c]) => c)].join("\n"),
  "_locales/ru": Object.values(messages).map((m) => m.message.replace(/\$\w+\$/g, "X")).join(".\n"),
  "docs/ru/index.html": strip(readFileSync(join(ROOT, "docs/ru/index.html"), "utf8")),
};
for (const page of ["kak-ubrat-shorts-youtube", "youtube-bez-rekomendaciy"]) {
  const file = join(ROOT, "docs/ru", page, "index.html");
  if (existsSync(file)) sources[`docs/ru/${page}`] = strip(readFileSync(file, "utf8"));
}

const dir = mkdtempSync(join(tmpdir(), "errand-copy-"));
let failed = 0;
for (const [name, text] of Object.entries(sources)) {
  const file = join(dir, `${name.replace(/[^\w.-]+/g, "_")}.txt`);
  writeFileSync(file, text);
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [GATE, file], { env: { ...process.env, CHECK_TEXT_NO_LT: "1" }, encoding: "utf8" });
  } catch (error) {
    out = String(error.stdout || "");
    code = error.status || 1;
  }
  const errors = out.split("\n").filter((line) => line.trim().startsWith("✕") && !/критичн/.test(line));
  console.log(`${code ? "FAIL" : "ok  "} ${name}${errors.length ? `\n  ${errors.join("\n  ")}` : ""}`);
  if (code) failed += 1;
}
console.log(failed ? `check:copy: ${failed} source(s) with errors` : "check:copy: clean");
process.exitCode = failed ? 1 : 0;
