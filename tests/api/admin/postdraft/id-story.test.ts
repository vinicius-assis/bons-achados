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

import { GET } from "@/app/api/admin/postdraft/[id]/story/route";
import { getPostDraftById } from "@/lib/postdraft/store";
import { fetchImageBuffer, composeStory } from "@/lib/postdraft/images";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("GET /api/admin/postdraft/[id]/story", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/postdraft/cd1/story"), {
      params: Promise.resolve({ id: "cd1" }),
    });

    expect(response.status).toBe(401);
    expect(getPostDraftById).not.toHaveBeenCalled();
  });

  it("returns 404 when the post draft does not exist", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(404);
  });

  it("composes and returns the story JPEG using imageTitle", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      price: 59.9,
      title: "Creatina 1kg",
      imageTitle: "Creatina em Pó 1kg",
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeStory).mockResolvedValue(Buffer.from("jpeg-bytes"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(composeStory).toHaveBeenCalledWith(
      Buffer.from("product-image"),
      Buffer.from("moldura"),
      59.9,
      "Creatina em Pó 1kg"
    );
  });

  it("falls back to title when imageTitle is null", async () => {
    vi.mocked(getPostDraftById).mockResolvedValue({
      id: "cd1",
      image: "https://img.example/1.webp",
      price: 59.9,
      title: "Creatina 1kg",
      imageTitle: null,
    } as never);
    vi.mocked(fetchImageBuffer).mockResolvedValue(Buffer.from("product-image"));
    vi.mocked(composeStory).mockResolvedValue(Buffer.from("jpeg-bytes"));

    await GET(
      new NextRequest("http://localhost/api/admin/postdraft/cd1/story", { headers: authHeader() }),
      { params: Promise.resolve({ id: "cd1" }) }
    );

    expect(composeStory).toHaveBeenCalledWith(
      Buffer.from("product-image"),
      Buffer.from("moldura"),
      59.9,
      "Creatina 1kg"
    );
  });
});
