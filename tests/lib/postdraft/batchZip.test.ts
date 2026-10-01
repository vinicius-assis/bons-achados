import { describe, it, expect, vi } from "vitest";
import { buildBatchZip, type BatchItem } from "@/lib/postdraft/batchZip";
import { ManifestValidationError } from "@/lib/postdraft/manifest";

function item(n: number, overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: `id${n}`,
    title: `Produto ${n}`,
    affiliateLink: `https://meli.la/${n}`,
    marketplace: "MERCADO_LIVRE",
    ...overrides,
  };
}

function readNames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const names: string[] = [];
  let offset = 0;
  while (offset + 4 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    names.push(decoder.decode(zip.subarray(offset + 30, offset + 30 + nameLen)));
    offset += 30 + nameLen + size;
  }
  return names;
}

describe("buildBatchZip", () => {
  it("zips manifest.json first, then one numbered jpeg per item in order", async () => {
    const fetchStory = vi.fn(async (id: string) => new Uint8Array([1, 2, Number(id.slice(2))]));
    const zip = await buildBatchZip([item(1), item(2), item(3)], fetchStory, new Date("2026-10-01"));
    expect(readNames(zip)).toEqual([
      "manifest.json",
      "001-produto-1.jpg",
      "002-produto-2.jpg",
      "003-produto-3.jpg",
    ]);
  });

  it("limits concurrency and reports progress", async () => {
    let active = 0;
    let peak = 0;
    const fetchStory = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return new Uint8Array([1]);
    };
    const progress: number[] = [];
    await buildBatchZip(
      Array.from({ length: 10 }, (_, i) => item(i + 1)),
      fetchStory,
      new Date(),
      { concurrency: 3, onProgress: (done) => progress.push(done) }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(progress.at(-1)).toBe(10);
  });

  it("rejects an invalid batch before fetching any image", async () => {
    const fetchStory = vi.fn();
    await expect(
      buildBatchZip([item(1, { affiliateLink: "http://x" })], fetchStory, new Date())
    ).rejects.toBeInstanceOf(ManifestValidationError);
    expect(fetchStory).not.toHaveBeenCalled();
  });

  it("propagates a failed story fetch", async () => {
    const fetchStory = vi.fn().mockRejectedValue(new Error("story_failed:id1:500"));
    await expect(buildBatchZip([item(1)], fetchStory, new Date())).rejects.toThrow("story_failed");
  });
});
