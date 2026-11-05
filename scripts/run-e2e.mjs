import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distStale, sourceHash } from "../tests/e2e/harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGS = join(ROOT, ".e2e-out/gate");
const TIMEOUT_MS = Number(process.env.E2E_SCRIPT_TIMEOUT_MS || 15 * 60 * 1000);

const SUITES = {
  fast: [
    ["smoke", { nt: /autoplay|^end:|shorts: link opens/ }],
    ["v02-strict-exit"],
    ["qa-v02-health-recover"],
    ["qa-v02-health-settings"],
    ["v03-notes"],
    ["v02-update", { nt: /plain browser restart/ }],
    ["qa-v03-search-shelves", { nt: /precondition|shelf was present|shelf visible with/ }],
    ["v03-locale-shorts", { nt: /precondition/ }],
    ["v03-watch-layout", { env: { MODES: "baseline,grid" }, nt: /precondition/ }],
    ["qa-v02-pages", { nt: /precondition/ }],
    ["v02-health", { nt: /precondition/ }],
  ],
  release: [
    ["v02-locales"],
    ["qa-v02-popup-locales"],
    ["qa-v02-welcome-locales"],
    ["polish-popup-fold"],
    ["qa-v02-popup", { nt: /precondition/ }],
    ["qa-v02-release", { nt: /precondition|playback|manual/i }],
    ["v02-pause"],
    ["v02-stats", { nt: /incognito/ }],
    ["v02-welcome"],
    ["qa-v02-strict-title"],
    ["qa-v02-subs-leak"],
    ["v02-regress"],
  ],
};

const names = process.argv.slice(2);
const unknown = names.filter((n) => !SUITES[n]);
if (!names.length || unknown.length) {
  console.error(`usage: node scripts/run-e2e.mjs <${Object.keys(SUITES).join("|")}>...${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
  process.exit(2);
}
const only = new Set((process.env.E2E_ONLY || "").split(",").filter(Boolean));
const skip = new Set((process.env.E2E_SKIP || "").split(",").filter(Boolean));
const plan = names.flatMap((n) => SUITES[n]).filter(([name]) => !only.size || only.has(name));

const stale = distStale();
const commit = (() => {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: ROOT }).toString().trim();
    return `${head}${dirty ? "+dirty" : ""}`;
  } catch {
    return "unknown";
  }
})();
const SOURCES = sourceHash();
console.log(`e2e gate: ${names.join(" + ")} · ${plan.length} scripts · commit ${commit} · sources ${SOURCES}`);
if (stale.length) {
  console.log(`FAIL dist/chrome is older than the sources (${stale.join(", ")}): run npm run build`);
  process.exit(1);
}

mkdirSync(LOGS, { recursive: true });
let current = null;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => {
    current?.kill(sig);
    setTimeout(() => process.exit(130), 3000).unref();
  });
}

function run(name, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const child = spawn(process.execPath, [join(ROOT, "tests/e2e", `${name}.mjs`)], { cwd: ROOT, env: { ...process.env, ...env, E2E_GATE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    current = child;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      out += `\ngate: killed after ${TIMEOUT_MS} ms\n`;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      current = null;
      resolve({ code: code ?? (signal ? 1 : 0), out, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

const rows = [];
for (const [name, opts = {}] of plan) {
  if (skip.has(name)) {
    rows.push({ name, status: "SKIP", note: "E2E_SKIP" });
    console.log(`SKIP ${name}`);
    continue;
  }
  const { code, out, seconds } = await run(name, opts.env || {});
  writeFileSync(join(LOGS, `${name}.log`), out);
  const lines = out.split("\n");
  const result = /RESULT pass=(\d+) fail=(\d+) nt=(\d+)/.exec(out);
  const failed = lines.filter((l) => l.startsWith("FAIL "));
  const nt = lines.filter((l) => l.startsWith("NOT TESTABLE ")).map((l) => l.slice(13));
  const badNT = nt.filter((l) => !(opts.nt && opts.nt.test(l)));
  const [pass, fail, ntCount] = result ? result.slice(1).map(Number) : [0, 0, 0];
  let status = "PASS";
  let note = `${pass} pass, ${ntCount} not testable, ${seconds} s`;
  if (!result) [status, note] = ["FAIL", `crashed before reporting (exit ${code}, ${seconds} s): ${lines.filter(Boolean).slice(-3).join(" | ").slice(0, 300)}`];
  else if (fail || code !== 0) [status, note] = ["FAIL", `${fail} fail, ${pass} pass, ${ntCount} not testable${code !== 0 && !fail ? `, exit ${code}` : ""}, ${seconds} s`];
  else if (badNT.length) [status, note] = ["FAIL", `${badNT.length} check(s) NOT TESTABLE where a real result is required, ${seconds} s`];
  rows.push({ name, status, note, failed, badNT });
  console.log(`${status} ${name} — ${note}`);
  for (const l of failed) console.log(`    ${l.slice(0, 240)}`);
  for (const l of badNT) console.log(`    NOT TESTABLE (required) ${l.slice(0, 220)}`);
}

const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`\n${"script".padEnd(26)} result`);
for (const r of rows) console.log(`${r.name.padEnd(26)} ${r.status.padEnd(5)} ${r.note}`);
console.log(`\ne2e gate: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("SKIP")} SKIP · commit ${commit} · sources ${SOURCES} · logs in .e2e-out/gate/`);
const after = distStale();
if (after.length) console.log(`WARN sources changed while the gate ran (${after.join(", ")}); results are for the build checked at the start`);
process.exitCode = count("FAIL") ? 1 : 0;
