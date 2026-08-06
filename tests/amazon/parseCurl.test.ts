import { describe, it, expect } from "vitest";
import { parseCurlCommand } from "@/lib/amazon/parseCurl";

const REAL_CURL = `curl --url 'https://www.amazon.com.br/d2b/api/v1/products/search?pageSize=30' \\
  -H 'accept: */*' \\
  -b 'aws-waf-token=abc123; session-id=130-3461055-6134122; at-acbbr=Atza|xyz' \\
  -H 'referer: https://www.amazon.com.br/events/ofertasmensais' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64)'`;

describe("parseCurlCommand", () => {
  it("extracts the cookie header from a real DevTools-copied curl", () => {
    const result = parseCurlCommand(REAL_CURL);

    expect(result).toEqual({
      cookieHeader: "aws-waf-token=abc123; session-id=130-3461055-6134122; at-acbbr=Atza|xyz",
    });
  });

  it("supports --cookie as a long-form flag", () => {
    const curl = `curl --cookie 'a=b; c=d'`;

    expect(parseCurlCommand(curl)).toEqual({ cookieHeader: "a=b; c=d" });
  });

  it("supports the cookie passed as a Cookie: header instead of -b", () => {
    const curl = `curl -H 'cookie: a=b; c=d'`;

    expect(parseCurlCommand(curl)).toEqual({ cookieHeader: "a=b; c=d" });
  });

  it("returns null when the cookie is missing", () => {
    expect(parseCurlCommand("curl https://example.com")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseCurlCommand("")).toBeNull();
  });
});
