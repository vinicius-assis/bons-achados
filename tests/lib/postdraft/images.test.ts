import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import {
  composeStory,
  composeFeedSlide,
  loadMolduraDiagonalStory,
  loadSelo,
  fitTitleText,
  TITLE_SIDE_MARGIN,
  FONT_FAMILY,
} from "@/lib/postdraft/images";

async function fakeProductImage(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe("composeStory", () => {
  it("returns a 1080x1920 JPEG with the price pill and title composited on top of the moldura", async () => {
    const buffer = await composeStory(
      await fakeProductImage(),
      loadMolduraDiagonalStory(),
      59.9,
      "Creatina 1kg Suplemento em Pó"
    );
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });
});

describe("composeFeedSlide", () => {
  it("returns a 1080x1350 JPEG with the selo and title composited on top", async () => {
    const buffer = await composeFeedSlide(
      await fakeProductImage(),
      loadSelo(),
      "Creatina 1kg Suplemento em Pó"
    );
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });
});

describe("fitTitleText", () => {
  it("keeps a short title on a single line at the starting font size", () => {
    const { lines, fontSize } = fitTitleText("Fone Bluetooth", 1080);

    expect(lines).toEqual(["Fone Bluetooth"]);
    expect(fontSize).toBe(64);
  });

  it("wraps a long title into at most 3 lines", () => {
    const longTitle =
      "Fone de Ouvido Bluetooth 5.3 Sem Fio com Cancelamento de Ruído Ativo e Estojo de Carregamento Rápido USB-C";

    const { lines, fontSize } = fitTitleText(longTitle, 1080);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(fontSize).toBeLessThanOrEqual(64);
  });

  it("never returns more than 3 lines even for an extremely long title", () => {
    const extremeTitle = "Produto ".repeat(60).trim();

    const { lines } = fitTitleText(extremeTitle, 1080);

    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("hard-breaks a single unbreakable word so no line overflows the canvas width", () => {
    const canvasWidth = 1080;
    const unbreakableWord = "A".repeat(60);
    const title = `Fone ${unbreakableWord} Bluetooth`;

    const { lines, fontSize } = fitTitleText(title, canvasWidth);

    const measureCanvas = createCanvas(canvasWidth, 1);
    const ctx = measureCanvas.getContext("2d");
    ctx.font = `${fontSize}px "${FONT_FAMILY}"`;
    const maxTextWidth = canvasWidth - TITLE_SIDE_MARGIN * 2;

    for (const line of lines) {
      expect(ctx.measureText(line).width).toBeLessThanOrEqual(maxTextWidth);
    }
  });
});
