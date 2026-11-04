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

const BG = pathToFileURL(join(ROOT, "store/art/bg-v1.png")).href;

function tile(width, height, text, o) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .tile { position: relative; width: ${width}px; height: ${height}px; background: #14342E url(${BG}) no-repeat;
      background-size: auto 100%; background-position: ${o.bgX} center; }
    .tile::before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, #14342E 0%, #14342E 45%, rgba(20,52,46,0) 70%); }
    .text { position: absolute; left: ${o.pad}px; top: 0; bottom: 0; width: ${o.textW}px; display: flex; flex-direction: column; justify-content: center; }
    .brand { display: flex; align-items: center; gap: ${o.icon * 0.3}px; margin-bottom: ${o.gap}px; }
    svg { width: ${o.icon}px; height: ${o.icon}px; flex: none; border-radius: 22%; box-shadow: 0 0 0 ${o.icon / 40}px rgba(244,235,217,0.14); }
    .name { font-size: ${o.name}px; font-weight: 700; letter-spacing: -0.02em; }
    .slogan { white-space: ${o.sub ? "normal" : "nowrap"}; font-size: ${o.slogan}px; font-weight: 650; line-height: 1.15; letter-spacing: -0.015em; }
    .sub { white-space: nowrap; font-size: ${o.sub}px; opacity: 0.78; margin-top: ${o.gap * 0.8}px; line-height: 1.3; }
  </style></head><body><div class="tile"><div class="text">
    <div class="brand">${mark}<div class="name">Errand</div></div>
    <div class="slogan">${text.slogan}</div>
    ${text.sub ? `<div class="sub">${text.sub}</div>` : ""}
  </div></div></body></html>`;
}

const SMALL = { pad: 24, textW: 290, icon: 32, name: 22, slogan: 23, sub: 0, gap: 12, bgX: "-150px" };
const LARGE = { pad: 96, textW: 760, icon: 84, name: 54, slogan: 58, sub: 30, gap: 28, bgX: "right" };

for (const [locale, copy] of Object.entries(COPY)) {
  if (process.env.ONLY && process.env.ONLY !== locale) continue;
  if (!process.env.TILES_ONLY) copy.screens.forEach(([file, caption], index) => {
    const image = join(SHOTS, locale, file);
    if (!existsSync(image)) {
      console.log(`skip ${locale}/${file} (no screenshot yet)`);
      return;
    }
    const out = join(OUT, locale, `screenshot-${index + 1}.png`);
    shoot(screenshotPage(caption, image), 1280, 800, out);
    console.log(out);
  });
  shoot(tile(440, 280, { slogan: copy.tile }, SMALL), 440, 280, join(OUT, locale, "promo-small-440x280.png"));
  shoot(tile(1400, 560, { slogan: copy.marquee, sub: copy.marqueeSub }, LARGE), 1400, 560, join(OUT, locale, "promo-marquee-1400x560.png"));
}
