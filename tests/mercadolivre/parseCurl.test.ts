import { describe, it, expect } from "vitest";
import { parseCurlCommand } from "@/lib/mercadolivre/parseCurl";

const REAL_CURL = `curl --url 'https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'content-type: application/json' \\
  -b '_csrf=G7uhBDJ3V8tXdHxoqf6D3gqE; g_state={"i_l":0}; ssid=ghy-080209-abc123' \\
  -H 'device-memory: 16' \\
  -H 'origin: https://www.mercadolivre.com.br' \\
  -H 'referer: https://www.mercadolivre.com.br/afiliados/hub' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64)' \\
  -H 'x-csrf-token: rSeC20ML-NEX8TY_EL2BKQzuhiCpVwA7oA9I' \\
  -H 'x-custom-origin: https://www.mercadolivre.com.br' \\
  --data-raw '{"search":"","sort":"relevance","filters":[{"id":"best_seller","value":true}],"offset":0}'`;

describe("parseCurlCommand", () => {
  it("extracts the cookie header and csrf token from a real DevTools-copied curl", () => {
    const result = parseCurlCommand(REAL_CURL);

    expect(result).toEqual({
      cookieHeader: '_csrf=G7uhBDJ3V8tXdHxoqf6D3gqE; g_state={"i_l":0}; ssid=ghy-080209-abc123',
      csrfToken: "rSeC20ML-NEX8TY_EL2BKQzuhiCpVwA7oA9I",
    });
  });

  it("is case-insensitive on the x-csrf-token header name", () => {
    const curl = `curl -H 'X-CSRF-Token: TOKEN123' -b 'a=b'`;

    expect(parseCurlCommand(curl)).toEqual({ cookieHeader: "a=b", csrfToken: "TOKEN123" });
  });

  it("supports --cookie and --header as long-form flags", () => {
    const curl = `curl --header 'x-csrf-token: TOKEN123' --cookie 'a=b; c=d'`;

    expect(parseCurlCommand(curl)).toEqual({ cookieHeader: "a=b; c=d", csrfToken: "TOKEN123" });
  });

  it("supports the cookie passed as a Cookie: header instead of -b", () => {
    const curl = `curl -H 'cookie: a=b; c=d' -H 'x-csrf-token: TOKEN123'`;

    expect(parseCurlCommand(curl)).toEqual({ cookieHeader: "a=b; c=d", csrfToken: "TOKEN123" });
  });

  it("returns null when the cookie is missing", () => {
    const curl = `curl -H 'x-csrf-token: TOKEN123'`;

    expect(parseCurlCommand(curl)).toBeNull();
  });

  it("returns null when the csrf token is missing", () => {
    const curl = `curl -b 'a=b'`;

    expect(parseCurlCommand(curl)).toBeNull();
  });

  it("returns null for empty or unrelated input", () => {
    expect(parseCurlCommand("")).toBeNull();
    expect(parseCurlCommand("not a curl command at all")).toBeNull();
  });
});
