import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  getPostDraftById: vi.fn(),
}));
vi.mock("@/lib/postdraft/images", () => ({
  fetchImageBuffer: vi.fn(),
  loadMolduraDiagonalStory: vi.fn(() => Buffer.from("moldura")),
  composeStory: vi.fn(),
}));

import { POST } from "@/app/api/admin/postdraft/lote/route";
import { getPostDraftById } from "@/lib/postdraft/store";
import { fetchImageBuffer, composeStory } from "@/lib/postdraft/images";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function request(body: unknown, authed = true) {
  return new NextRequest("http://localhost/api/admin/postdraft/lote", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authed ? { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function fakeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "cd1",
    image: "https://img.example/1.webp",
    price: 59.9,
    title: "Tênis Branco",
    imageTitle: "Tênis Branco Casual",
    affiliateLink: "https://bonsachados.links/r/1",
    marketplace: "MERCADO_LIVRE",
    ...overrides,
  };
}

// Reads the store-only archive back into { name -> bytes }.
function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    out.set(decoder.decode(zip.subarray(nameStart, nameStart + nameLen)), zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return out;
}

describe("POST /api/admin/postdraft/lote", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without a valid session", async () => {
    const response = await POST(request({ ids: ["cd1"] }, false));
    expect(response.status).toBe(401);
    expect(getPostDraftById).not.toHaveBeenCalled();
  });

  it("returns 400 when ids is empty", async () => {
    const response = await POST(request({ ids: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when a draft is missing", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue(null);
    const response = await POST(request({ ids: ["gone"] }));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ id: "gone" });
  });

  it("returns 422 when a draft link is not https", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue(
      fakeDraft({ affiliateLink: "http://insecure.example" }) as never
    );
    const response = await POST(request({ ids: ["cd1"] }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ erro: "validacao" });
  });

  it("returns a zip with manifest.json and one story image per draft, in order", async () => {
    vi.mocked(getPostDraftById).mockImplementation((async (id: string) => {
      if (id === "cd1") return fakeDraft({ id: "cd1", title: "Tênis Branco", marketplace: "MERCADO_LIVRE" });
      if (id === "cd2") return fakeDraft({ id: "cd2", title: "Fone Bluetooth", marketplace: "SHOPEE" });
      return null;
    }) as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product"));
    vi.mocked(composeStory).mockImplementation((async (_p: unknown, _m: unknown, _price: unknown, title: string) =>
      Buffer.from(`jpeg:${title}`)) as never);

    const response = await POST(request({ ids: ["cd2", "cd1"] }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="lote-\d{4}-\d{2}-\d{2}\.zip"/);

    const entries = readZip(new Uint8Array(await response.arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(entries.get("manifest.json")));

    expect(manifest.version).toBe(1);
    expect(manifest.stories.map((s: { id: string }) => s.id)).toEqual(["cd2", "cd1"]);
    expect(manifest.stories[0]).toMatchObject({
      image: "001-fone-bluetooth.jpg",
      sticker_text: "Shopee",
      link: "https://bonsachados.links/r/1",
    });
    expect(entries.has("001-fone-bluetooth.jpg")).toBe(true);
    expect(entries.has("002-tenis-branco.jpg")).toBe(true);
    // story image is composed from imageTitle, same as the /story route
    expect(new TextDecoder().decode(entries.get("002-tenis-branco.jpg"))).toBe("jpeg:Tênis Branco Casual");
  });
});
