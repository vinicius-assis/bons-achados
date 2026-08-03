import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  composeStory,
  composeFeedSlide,
  loadMolduraDiagonalStory,
  loadSelo,
} from "@/lib/postdraft/images";

async function fakeProductImage(): Promise<Buffer> {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe("composeStory", () => {
  it("returns a 1080x1920 JPEG with the price pill composited on top of the moldura", async () => {
    const buffer = await composeStory(await fakeProductImage(), loadMolduraDiagonalStory(), 59.9);
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1920);
  });
});

describe("composeFeedSlide", () => {
  it("returns a 1080x1350 JPEG with the selo composited on top", async () => {
    const buffer = await composeFeedSlide(await fakeProductImage(), loadSelo());
    const metadata = await sharp(buffer).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBe(1350);
  });
});
