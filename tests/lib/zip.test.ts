import { describe, it, expect } from "vitest";
import { createZip } from "@/lib/zip";

// Minimal store-only reader: walks local file headers and pulls each entry
// back out so we assert on the archive's real contents, not its byte layout.
function readStoredZip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const entries: { name: string; data: Uint8Array }[] = [];
  let offset = 0;
  while (offset + 4 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(zip.subarray(nameStart, nameStart + nameLength)),
      data: zip.subarray(dataStart, dataStart + compressedSize),
    });
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe("createZip", () => {
  it("round-trips file names and bytes for each stored entry", () => {
    const files = [
      { name: "manifest.json", data: new TextEncoder().encode('{"versao":1}') },
      { name: "001-tenis.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]) },
    ];

    const zip = createZip(files);
    const read = readStoredZip(zip);

    expect(read.map((e) => e.name)).toEqual(["manifest.json", "001-tenis.jpg"]);
    expect(read[0].data).toEqual(files[0].data);
    expect(read[1].data).toEqual(files[1].data);
  });

  it("ends with the end-of-central-directory record listing every entry", () => {
    const zip = createZip([
      { name: "a.txt", data: new Uint8Array([1]) },
      { name: "b.txt", data: new Uint8Array([2]) },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

    const eocdOffset = zip.length - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(view.getUint16(eocdOffset + 10, true)).toBe(2);
  });
});
