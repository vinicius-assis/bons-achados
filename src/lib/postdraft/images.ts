import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

const BRAND_KIT_DIR = path.join(process.cwd(), "assets/brand-kit");
const FONT_PATH = path.join(process.cwd(), "assets/fonts/ArchivoBlack-Regular.ttf");
const FONT_FAMILY = "Archivo Black";

const CANVAS_BG = { r: 245, g: 245, b: 245, alpha: 1 };
const CANVAS_MARGIN_RATIO = 0.06;

const PILL_WIDTH = 356;
const PILL_HEIGHT = 113;
const PILL_COLOR = "#F9B50C";
const PILL_TEXT_COLOR = "#0D1012";
const PILL_GAP_ABOVE_BAR = 41;
// Measured from the current MOLDURA_diagonal_story_1080x1920.png: the opaque
// bottom bar (thin gold rule + logo + "@bonsachados · link na bio" + legal
// disclaimer) starts at y=1658 on a 1920px-tall canvas, so its height is
// 1920 - 1658 = 262px. Re-measure this if the moldura asset changes again.
const BAR_HEIGHT = 262;

const SELO_MARGIN_RATIO = 0.05;
const SELO_SIZE_RATIO = 0.15;

const TITLE_SIDE_MARGIN = 80;
const TITLE_TOP_MARGIN = 90;
const TITLE_MAX_LINES = 3;
const TITLE_START_FONT = 64;
const TITLE_MIN_FONT = 36;
const TITLE_FONT_STEP = 4;
const TITLE_LINE_HEIGHT_RATIO = 1.2;
const TITLE_FILL_COLOR = "#FFFFFF";
const TITLE_STROKE_COLOR = "#0D1012";
const TITLE_STROKE_WIDTH = 6;

const FEED_SIZE = { width: 1080, height: 1350 };

let fontRegistered = false;
function ensureFontRegistered(): void {
  if (!fontRegistered) {
    GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
    fontRegistered = true;
  }
}

let molduraCache: Buffer | null = null;
export function loadMolduraDiagonalStory(): Buffer {
  if (!molduraCache) {
    molduraCache = readFileSync(path.join(BRAND_KIT_DIR, "MOLDURA_diagonal_story_1080x1920.png"));
  }
  return molduraCache;
}

let seloCache: Buffer | null = null;
export function loadSelo(): Buffer {
  if (!seloCache) {
    seloCache = readFileSync(path.join(BRAND_KIT_DIR, "SELO_70pct_400px.png"));
  }
  return seloCache;
}

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch product image: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fitOnCanvas(
  productImage: Buffer,
  size: { width: number; height: number }
): Promise<Buffer> {
  const maxWidth = Math.round(size.width * (1 - 2 * CANVAS_MARGIN_RATIO));
  const maxHeight = Math.round(size.height * (1 - 2 * CANVAS_MARGIN_RATIO));

  const { data: resized, info } = await sharp(productImage)
    .resize(maxWidth, maxHeight, { fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.round((size.width - info.width) / 2);
  const top = Math.round((size.height - info.height) / 2);

  return sharp({
    create: { width: size.width, height: size.height, channels: 3, background: CANVAS_BG },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

async function pasteOverlay(baseImage: Buffer, overlayImage: Buffer): Promise<Buffer> {
  return sharp(baseImage).composite([{ input: overlayImage }]).png().toBuffer();
}

function formatPillPrice(price: number): string {
  return `R$ ${price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawPricePillLayer(price: number, canvasWidth: number, canvasHeight: number): Buffer {
  ensureFontRegistered();
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  const x0 = Math.round((canvasWidth - PILL_WIDTH) / 2);
  const y1 = canvasHeight - BAR_HEIGHT - PILL_GAP_ABOVE_BAR;
  const y0 = y1 - PILL_HEIGHT;
  const radius = PILL_HEIGHT / 2;

  ctx.beginPath();
  ctx.moveTo(x0 + radius, y0);
  ctx.lineTo(x0 + PILL_WIDTH - radius, y0);
  ctx.arc(x0 + PILL_WIDTH - radius, y0 + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(x0 + PILL_WIDTH, y0 + PILL_HEIGHT - radius);
  ctx.arc(x0 + PILL_WIDTH - radius, y0 + PILL_HEIGHT - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(x0 + radius, y0 + PILL_HEIGHT);
  ctx.arc(x0 + radius, y0 + PILL_HEIGHT - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(x0, y0 + radius);
  ctx.arc(x0 + radius, y0 + radius, radius, Math.PI, Math.PI * 1.5);
  ctx.closePath();
  ctx.fillStyle = PILL_COLOR;
  ctx.fill();

  ctx.fillStyle = PILL_TEXT_COLOR;
  ctx.font = `54px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatPillPrice(price), x0 + PILL_WIDTH / 2, y0 + PILL_HEIGHT / 2);

  return canvas.toBuffer("image/png");
}

async function drawPricePill(canvasImage: Buffer, price: number): Promise<Buffer> {
  const metadata = await sharp(canvasImage).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const pillLayer = drawPricePillLayer(price, width, height);
  return sharp(canvasImage).composite([{ input: pillLayer }]).png().toBuffer();
}

function wrapTitleLines(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }

  return lines;
}

export function fitTitleText(
  title: string,
  canvasWidth: number
): { lines: string[]; fontSize: number } {
  ensureFontRegistered();
  const measureCanvas = createCanvas(canvasWidth, 1);
  const ctx = measureCanvas.getContext("2d");
  const maxTextWidth = canvasWidth - TITLE_SIDE_MARGIN * 2;

  for (let fontSize = TITLE_START_FONT; fontSize >= TITLE_MIN_FONT; fontSize -= TITLE_FONT_STEP) {
    ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
    const lines = wrapTitleLines(ctx, title, maxTextWidth);
    if (lines.length <= TITLE_MAX_LINES) {
      return { lines, fontSize };
    }
  }

  ctx.font = `${TITLE_MIN_FONT}px "${FONT_FAMILY}"`;
  return {
    lines: wrapTitleLines(ctx, title, maxTextWidth).slice(0, TITLE_MAX_LINES),
    fontSize: TITLE_MIN_FONT,
  };
}

function drawTitleLayer(title: string, canvasWidth: number, canvasHeight: number): Buffer {
  ensureFontRegistered();
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  const { lines, fontSize } = fitTitleText(title, canvasWidth);

  ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = TITLE_STROKE_WIDTH;
  ctx.strokeStyle = TITLE_STROKE_COLOR;
  ctx.fillStyle = TITLE_FILL_COLOR;

  const lineHeight = fontSize * TITLE_LINE_HEIGHT_RATIO;
  const centerX = canvasWidth / 2;

  lines.forEach((line, index) => {
    const y = TITLE_TOP_MARGIN + index * lineHeight;
    ctx.strokeText(line, centerX, y);
    ctx.fillText(line, centerX, y);
  });

  return canvas.toBuffer("image/png");
}

async function pasteTitle(canvasImage: Buffer, title: string): Promise<Buffer> {
  const metadata = await sharp(canvasImage).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const titleLayer = drawTitleLayer(title, width, height);
  return sharp(canvasImage).composite([{ input: titleLayer }]).png().toBuffer();
}

async function pasteSelo(canvasImage: Buffer, seloImage: Buffer): Promise<Buffer> {
  const canvasMeta = await sharp(canvasImage).metadata();
  const canvasWidth = canvasMeta.width ?? 0;
  const canvasHeight = canvasMeta.height ?? 0;
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const size = Math.round(shortSide * SELO_SIZE_RATIO);
  const margin = Math.round(canvasWidth * SELO_MARGIN_RATIO);

  const resizedSelo = await sharp(seloImage).resize(size, size).png().toBuffer();
  const left = canvasWidth - margin - size;
  const top = canvasHeight - margin - size;

  return sharp(canvasImage).composite([{ input: resizedSelo, left, top }]).png().toBuffer();
}

export async function composeStory(
  productImage: Buffer,
  molduraImage: Buffer,
  price: number,
  title: string
): Promise<Buffer> {
  const molduraMeta = await sharp(molduraImage).metadata();
  const size = { width: molduraMeta.width ?? 1080, height: molduraMeta.height ?? 1920 };

  let canvas = await fitOnCanvas(productImage, size);
  canvas = await pasteOverlay(canvas, molduraImage);
  canvas = await drawPricePill(canvas, price);
  canvas = await pasteTitle(canvas, title);

  return sharp(canvas).jpeg({ quality: 90 }).toBuffer();
}

export async function composeFeedSlide(
  productImage: Buffer,
  seloImage: Buffer,
  title: string
): Promise<Buffer> {
  let canvas = await fitOnCanvas(productImage, FEED_SIZE);
  canvas = await pasteSelo(canvas, seloImage);
  canvas = await pasteTitle(canvas, title);
  return sharp(canvas).jpeg({ quality: 90 }).toBuffer();
}
