import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/adminSession", () => ({ isAuthorizedAdminRequest: vi.fn() }));
vi.mock("@/lib/manualItems/createManualItems", () => ({ createManualItems: vi.fn() }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/admin/manual-items/route";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { createManualItems } from "@/lib/manualItems/createManualItems";

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/manual-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ITEM = {
  imageLink: "https://img.example/1.webp",
  name: "Fone Bluetooth JBL",
  price: 199.9,
  discount: 20,
  affiliateLink: "https://www.amazon.com.br/dp/B08N5WRWNW?tag=x",
  addToPost: false,
};

describe("POST /api/admin/manual-items", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is not authorized", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(false);

    const response = await POST(buildRequest({ items: [VALID_ITEM] }));

    expect(response.status).toBe(401);
    expect(createManualItems).not.toHaveBeenCalled();
  });

  it("returns 400 when items is missing or empty", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);

    const response = await POST(buildRequest({ items: [] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "invalid_body" });
    expect(createManualItems).not.toHaveBeenCalled();
  });

  it("returns 400 when an item is missing a required field", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);
    const invalidItem = { ...VALID_ITEM, name: "" };

    const response = await POST(buildRequest({ items: [invalidItem] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "invalid_body" });
    expect(createManualItems).not.toHaveBeenCalled();
  });

  it("returns 400 with unrecognizedIndices when createManualItems rejects the batch", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);
    vi.mocked(createManualItems).mockResolvedValue({ ok: false, unrecognizedIndices: [0] });

    const response = await POST(buildRequest({ items: [VALID_ITEM] }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "unrecognized_link", unrecognizedIndices: [0] });
  });

  it("returns 200 with per-item results on success, passing parsed and trimmed fields through", async () => {
    vi.mocked(isAuthorizedAdminRequest).mockReturnValue(true);
    vi.mocked(createManualItems).mockResolvedValue({
      ok: true,
      results: [{ status: "created", id: "hl1" }],
    });

    const response = await POST(
      buildRequest({ items: [{ ...VALID_ITEM, name: "  Fone Bluetooth JBL  " }] })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ results: [{ status: "created", id: "hl1" }] });
    expect(createManualItems).toHaveBeenCalledWith([{ ...VALID_ITEM, name: "Fone Bluetooth JBL" }]);
  });
});
