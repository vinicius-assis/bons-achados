import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/highlights/store", () => ({
  createHighlight: vi.fn(),
  listTodaysHighlights: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/highlights/route";
import { createHighlight, listTodaysHighlights } from "@/lib/highlights/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const VALID_BODY = {
  marketplace: "MERCADO_LIVRE",
  title: "Creatina 1kg",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  oldPrice: 89.9,
  discount: 33,
};

describe("GET /api/admin/highlights", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/highlights"));

    expect(response.status).toBe(401);
    expect(listTodaysHighlights).not.toHaveBeenCalled();
  });

  it("returns today's highlights", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([{ id: "hl1" }] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/highlights", { headers: authHeader() })
    );
    const body = await response.json();

    expect(body.items).toEqual([{ id: "hl1" }]);
  });
});

describe("POST /api/admin/highlights", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  function buildRequest(body: unknown, headers: Record<string, string> = authHeader()) {
    return new NextRequest("http://localhost/api/admin/highlights", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await POST(buildRequest(VALID_BODY, {}));

    expect(response.status).toBe(401);
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, title: "" }));

    expect(response.status).toBe(400);
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("returns 400 for a zero or negative price", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, price: 0 }));

    expect(response.status).toBe(400);
    expect(createHighlight).not.toHaveBeenCalled();
  });

  it("creates a highlight and returns 201", async () => {
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl1" } as never);

    const response = await POST(buildRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: "hl1" });
    expect(createHighlight).toHaveBeenCalledWith({
      marketplace: "MERCADO_LIVRE",
      title: "Creatina 1kg",
      affiliateLink: "https://meli.la/abc",
      image: "https://img.example/1.webp",
      price: 59.9,
      oldPrice: 89.9,
      discount: 33,
    });
  });

  it("defaults oldPrice and discount to null when omitted", async () => {
    vi.mocked(createHighlight).mockResolvedValue({ id: "hl2" } as never);
    const { oldPrice, discount, ...withoutOptional } = VALID_BODY;
    void oldPrice;
    void discount;

    await POST(buildRequest(withoutOptional));

    expect(createHighlight).toHaveBeenCalledWith(
      expect.objectContaining({ oldPrice: null, discount: null })
    );
  });
});
