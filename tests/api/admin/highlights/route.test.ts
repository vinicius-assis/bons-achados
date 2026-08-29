import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/highlights/store", () => ({
  listTodaysHighlights: vi.fn(),
  listHighlightsPage: vi.fn(),
}));

import { GET } from "@/app/api/admin/highlights/route";
import { listTodaysHighlights, listHighlightsPage } from "@/lib/highlights/store";
import { ADMIN_SESSION_COOKIE, createSessionToken } from "@/lib/adminSession";

function authHeader() {
  return { cookie: `${ADMIN_SESSION_COOKIE}=${createSessionToken()}` };
}

describe("GET /api/admin/highlights", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_PASSWORD;
  });

  it("returns 401 without calling listTodaysHighlights when the session cookie is missing or invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/highlights"));

    expect(response.status).toBe(401);
    expect(listTodaysHighlights).not.toHaveBeenCalled();
  });

  it("returns today's highlights across every marketplace when no marketplace param is given", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([{ id: "hl1" }] as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/highlights", { headers: authHeader() })
    );
    const body = await response.json();

    expect(listTodaysHighlights).toHaveBeenCalledWith(undefined);
    expect(body.items).toEqual([{ id: "hl1" }]);
  });

  it("filters by marketplace when the param is given and valid", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([] as never);

    await GET(
      new NextRequest("http://localhost/api/admin/highlights?marketplace=AMAZON", {
        headers: authHeader(),
      })
    );

    expect(listTodaysHighlights).toHaveBeenCalledWith("AMAZON");
  });

  it("ignores an invalid marketplace param and lists every marketplace instead", async () => {
    vi.mocked(listTodaysHighlights).mockResolvedValue([] as never);

    await GET(
      new NextRequest("http://localhost/api/admin/highlights?marketplace=NOT_REAL", {
        headers: authHeader(),
      })
    );

    expect(listTodaysHighlights).toHaveBeenCalledWith(undefined);
  });

  it("paginates the pool when a page param is given, returning items and totalPages", async () => {
    vi.mocked(listHighlightsPage).mockResolvedValue({
      items: [{ id: "hl1" }],
      totalPages: 4,
    } as never);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/highlights?marketplace=AMAZON&page=2", {
        headers: authHeader(),
      })
    );
    const body = await response.json();

    expect(listTodaysHighlights).not.toHaveBeenCalled();
    expect(listHighlightsPage).toHaveBeenCalledWith({
      page: 2,
      pageSize: 30,
      marketplaces: ["AMAZON"],
      q: "",
    });
    expect(body).toEqual({ items: [{ id: "hl1" }], totalPages: 4 });
  });

  it("clamps an invalid page value to 1", async () => {
    vi.mocked(listHighlightsPage).mockResolvedValue({ items: [], totalPages: 1 } as never);

    await GET(
      new NextRequest("http://localhost/api/admin/highlights?marketplace=SHOPEE&page=abc", {
        headers: authHeader(),
      })
    );

    expect(listHighlightsPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 })
    );
  });
});
