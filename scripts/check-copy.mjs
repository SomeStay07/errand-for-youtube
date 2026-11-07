import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(ROOT, ".claude", "text-gate", "check-text.mjs");

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n+/g, "\n");

const FORMAT = [
  [/[\u2014\u2013]/, "long dash"],
  [/[\u00ab\u00bb\u201e\u201c\u201d]/, "typographic quotes"],
  [/\u2192/, "arrow"],
];
const CLICHES = {
  en: /\b(seamless(ly)?|effortless(ly)?|unlock|supercharge|game[- ]changer|take back control|reclaim|elevate|empower|delve|journey|transform(s|ing)?|revolutioni[sz]e|harness|look no further|say goodbye to|whether you're|in today's|more than just|it's not just)\b/i,
  es: /(sin esfuerzo|revoluciona|desbloquea|potencia tu|siguiente nivel|recupera el control|transforma)/i,
  pt_BR: /(sem esforço|revoluciona|desbloqueie|potencialize|próximo nível|retome o controle|transforme)/i,
  de: /(nahtlos|mühelos|revolutionier|entfessel|nächste[ns]? Level|Kontrolle zurück|Reise)/i,
};
const listingBody = (lang) => readFileSync(join(ROOT, `store/listing/${lang}.md`), "utf8").split(/\n## [^\n]*\n/)[1] || "";
const allCaptions = JSON.parse(readFileSync(join(ROOT, "store/captions.json"), "utf8"));
const multi = {};
let failed = 0;
for (const lang of ["en", "ru", "es", "pt_BR", "de"]) {
  const msgs = JSON.parse(readFileSync(join(ROOT, `_locales/${lang}/messages.json`), "utf8"));
  const cap = allCaptions[lang];
  multi[`store/listing/${lang}.md`] = [lang, listingBody(lang)];
  multi[`store/captions.json (${lang})`] = [lang, [cap.tagline, ...cap.screens.map(([, c]) => c), cap.tile, cap.marquee, cap.marqueeSub].filter(Boolean).join("\n")];
  multi[`_locales/${lang}`] = [lang, Object.values(msgs).map((m) => m.message).join("\n")];
}
multi["docs/index.html"] = ["en", strip(readFileSync(join(ROOT, "docs/index.html"), "utf8"))];
for (const page of ["hide-youtube-shorts", "youtube-without-recommendations", "alternatives", "hide-youtube-end-screen", "breakage", "bye", "changes"]) {
  const file = join(ROOT, "docs", page, "index.html");
  if (existsSync(file)) multi[`docs/${page}`] = ["en", strip(readFileSync(file, "utf8"))];
}
for (const [lang, dir] of [["es", "es"], ["pt_BR", "pt-br"], ["de", "de"]]) {
  const file = join(ROOT, "docs", dir, "changes", "index.html");
  if (existsSync(file)) multi[`docs/${dir}/changes`] = [lang, strip(readFileSync(file, "utf8"))];
  else {
    console.log(`FAIL docs/${dir}/changes missing`);
    failed += 1;
  }
}
for (const doc of ["README.md", "PRIVACY.md"]) multi[doc] = ["en", readFileSync(join(ROOT, doc), "utf8")];
for (const [name, [lang, text]] of Object.entries(multi)) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const [re, label] of FORMAT) if (re.test(line)) hits.push(`${i + 1}: ${label}: ${line.trim().slice(0, 90)}`);
    const cliche = CLICHES[lang] && line.match(CLICHES[lang]);
    if (cliche) hits.push(`${i + 1}: cliche "${cliche[0]}": ${line.trim().slice(0, 90)}`);
  });
  console.log(`${hits.length ? "FAIL" : "ok  "} ${name} (format${CLICHES[lang] ? ", cliches" : ""})${hits.length ? `\n  ${hits.join("\n  ")}` : ""}`);
  if (hits.length) failed += 1;
}

if (!existsSync(GATE)) {
  console.log("check-text gate skipped: .claude/text-gate is not present on this machine");
  console.log(failed ? `check:copy: ${failed} source(s) with errors` : "check:copy: clean");
  process.exit(failed ? 1 : 0);
}

const listing = readFileSync(join(ROOT, "store/listing/ru.md"), "utf8").split(/\n## [^\n]*\n/)[1] || "";
const captions = JSON.parse(readFileSync(join(ROOT, "store/captions.json"), "utf8")).ru;
const messages = JSON.parse(readFileSync(join(ROOT, "_locales/ru/messages.json"), "utf8"));
const sources = {
  "store/listing/ru.md": listing,
  "store/captions.json (ru)": [captions.tagline.replace(/<br>/g, " "), ...captions.screens.map(([, c]) => c)].join("\n"),
  "_locales/ru": Object.values(messages).map((m) => m.message.replace(/\$\w+\$/g, "X")).join(".\n"),
  "docs/ru/index.html": strip(readFileSync(join(ROOT, "docs/ru/index.html"), "utf8")),
};
for (const page of ["kak-ubrat-shorts-youtube", "youtube-bez-rekomendaciy", "kak-ubrat-konechnuyu-zastavku-youtube", "changes"]) {
  const file = join(ROOT, "docs/ru", page, "index.html");
  if (existsSync(file)) sources[`docs/ru/${page}`] = strip(readFileSync(file, "utf8"));
}

const dir = mkdtempSync(join(tmpdir(), "errand-copy-"));
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
