import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const mark = readFileSync(join(ROOT, "assets/mark.svg"), "utf8");

export function shoot(html, width, height, out) {
  const dir = mkdtempSync(join(tmpdir(), "errand-render-"));
  const page = join(dir, "page.html");
  writeFileSync(page, html);
  mkdirSync(dirname(out), { recursive: true });
  const run = () => execFileSync(
    CHROME,
    [
      "--headless=new",
      "--use-mock-keychain",
      "--password-store=basic",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      pathToFileURL(page).href,
    ],
    { stdio: "ignore", timeout: 60000 },
  );
  try {
    run();
  } catch {
    run();
  }
  rmSync(dir, { recursive: true, force: true });
}

function iconHtml(size, padding) {
  const inner = size - padding * 2;
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
${mark.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}
</div></body></html>`;
}

const ICONS = [
  [16, 0],
  [32, 0],
  [48, 2],
  [128, 16],
];

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  for (const [size, padding] of ICONS) {
    const out = join(ROOT, "icons", `icon-${size}.png`);
    shoot(iconHtml(size, padding), size, size, out);
    console.log(out);
  }
  shoot(iconHtml(1024, 0), 1024, 1024, join(ROOT, "store/images/icon-1024.png"));
}
