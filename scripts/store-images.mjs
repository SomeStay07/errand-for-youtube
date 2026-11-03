import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shoot } from "./render.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || join(ROOT, "store/shots");
const OUT = join(ROOT, "store/images");
const mark = readFileSync(join(ROOT, "assets/mark.svg"), "utf8");

const COPY = JSON.parse(readFileSync(join(ROOT, "store/captions.json"), "utf8"));

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body {
    background: #16302B;
    color: #F4EBD9;
    font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
`;

function screenshotPage(caption, image) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .frame { width: 1280px; height: 800px; padding: 56px 80px 0; display: flex; flex-direction: column; gap: 40px; }
    h1 { font-size: 46px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.15; max-width: 1040px; }
    .shot { flex: 1; min-height: 0; border-radius: 14px 14px 0 0; overflow: hidden;
      box-shadow: 0 -2px 0 rgba(244,235,217,0.08), 0 24px 60px rgba(0,0,0,0.35); }
    .shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  </style></head><body><div class="frame">
    <h1>${caption}</h1>
    <div class="shot"><img src="${pathToFileURL(image).href}"></div>
  </div></body></html>`;
}

function tile(width, height, tagline, scale) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .tile { width: ${width}px; height: ${height}px; display: flex; align-items: center; gap: ${28 * scale}px; padding: 0 ${48 * scale}px; }
    svg { width: ${96 * scale}px; height: ${96 * scale}px; flex: none; }
    .name { font-size: ${54 * scale}px; font-weight: 700; letter-spacing: -0.02em; }
    .tag { font-size: ${24 * scale}px; opacity: 0.8; margin-top: ${8 * scale}px; line-height: 1.3; }
  </style></head><body><div class="tile">
    ${mark.replace("<svg ", '<svg style="border-radius:22%;box-shadow:0 0 0 2px rgba(244,235,217,0.12)" ')}
    <div><div class="name">Errand</div><div class="tag">${tagline}</div></div>
  </div></body></html>`;
}

for (const [locale, copy] of Object.entries(COPY)) {
  copy.screens.forEach(([file, caption], index) => {
    const image = join(SHOTS, locale, file);
    if (!existsSync(image)) {
      console.log(`skip ${locale}/${file} (no screenshot yet)`);
      return;
    }
    const out = join(OUT, locale, `screenshot-${index + 1}.png`);
    shoot(screenshotPage(caption, image), 1280, 800, out);
    console.log(out);
  });
  shoot(tile(440, 280, copy.tagline, 0.62), 440, 280, join(OUT, locale, "promo-small-440x280.png"));
  shoot(tile(1400, 560, copy.tagline, 1.6), 1400, 560, join(OUT, locale, "promo-marquee-1400x560.png"));
}
