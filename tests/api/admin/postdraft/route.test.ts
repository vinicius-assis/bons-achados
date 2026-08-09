import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/postdraft/store", () => ({
  createPostDraft: vi.fn(),
  listActivePostDrafts: vi.fn(),
}));

import { GET, POST } from "@/app/api/admin/postdraft/route";
import { createPostDraft, listActivePostDrafts } from "@/lib/postdraft/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

const VALID_BODY = {
  marketplace: "MERCADO_LIVRE",
  source: "AUTO",
  title: "Creatina 1kg",
  imageTitle: "Creatina 1kg",
  affiliateLink: "https://meli.la/abc",
  image: "https://img.example/1.webp",
  price: 59.9,
  discount: 25,
  category: null,
};

describe("GET /api/admin/postdraft", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/postdraft"));

    expect(response.status).toBe(401);
    expect(listActivePostDrafts).not.toHaveBeenCalled();
  });

  it("returns the active queue and a caption built from it", async () => {
    vi.mocked(listActivePostDrafts).mockResolvedValue([
      {
        id: "cd1",
        title: "Creatina 1kg",
        marketplace: "MERCADO_LIVRE",
        category: "suplemento",
        discount: 72,
      },
    ] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/postdraft", { headers: authHeader() })
    );
    const body = await response.json();

    expect(body.items).toHaveLength(1);
    expect(body.caption).toContain("Creatina 1kg");
    expect(body.caption).toContain("72% OFF");
  });
});

describe("POST /api/admin/postdraft", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  function buildRequest(body: unknown, headers: Record<string, string> = authHeader()) {
    return new NextRequest("http://localhost/api/admin/postdraft", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("returns 401 when the session cookie is missing or invalid", async () => {
    const response = await POST(buildRequest(VALID_BODY, {}));

    expect(response.status).toBe(401);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing required field", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, title: "" }));

    expect(response.status).toBe(400);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing imageTitle", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, imageTitle: "" }));

    expect(response.status).toBe(400);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for a zero price", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, price: 0 }));

    expect(response.status).toBe(400);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for a negative price", async () => {
    const response = await POST(buildRequest({ ...VALID_BODY, price: -10 }));

    expect(response.status).toBe(400);
    expect(createPostDraft).not.toHaveBeenCalled();
  });

  it("creates a post draft and returns 201", async () => {
    vi.mocked(createPostDraft).mockResolvedValue({ status: "created", id: "cd1", category: "suplemento" });

    const response = await POST(buildRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: "cd1", category: "suplemento" });
  });

  it("returns 409 when createPostDraft reports a duplicate", async () => {
    const createdAt = new Date("2026-08-03T13:00:00.000Z");
    vi.mocked(createPostDraft).mockResolvedValue({ status: "duplicate", createdAt });

    const response = await POST(buildRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("duplicate");
  });
});
