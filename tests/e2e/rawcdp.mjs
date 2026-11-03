import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { EXT, OUT, sleep } from "./harness.mjs";

const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function rawLaunch(name, port) {
  const profile = join(OUT, `profile-${name}`);
  rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--no-default-browser-check", "--use-mock-keychain", "--password-store=basic", "--window-position=-2000,0", "--window-size=1280,800", "--lang=en-US", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      break;
    } catch {
      await sleep(200);
    }
  }
  const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const connect = async (match) => {
    let t;
    for (let i = 0; i < 50 && !t; i++) {
      t = (await list()).find(match);
      if (!t) await sleep(200);
    }
    if (!t) throw new Error("target not found");
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    ws.addEventListener("close", () => { for (const r of pending.values()) r({}); });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    return { t, send, evaluate, close: () => ws.close() };
  };
  return { proc, list, connect, kill: () => proc.kill() };
}
