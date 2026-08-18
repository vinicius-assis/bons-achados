export type ParsedCurlSession = {
  cookieHeader: string;
};

function extractCookieHeader(curlCommand: string): string | undefined {
  const match =
    curlCommand.match(/(?:^|\s)(?:-b|--cookie)\s+'([^']*)'/) ??
    curlCommand.match(/(?:^|\s)(?:-b|--cookie)\s+"([^"]*)"/) ??
    curlCommand.match(/(?:^|\s)(?:-H|--header)\s+'[Cc]ookie:\s*([^']*)'/) ??
    curlCommand.match(/(?:^|\s)(?:-H|--header)\s+"[Cc]ookie:\s*([^"]*)"/);
  return match?.[1]?.trim() || undefined;
}

/**
 * Parses a "Copy as cURL" command captured from the browser DevTools Network
 * tab against Amazon's ofertasmensais deals endpoint, extracting the one
 * value the app needs (the Cookie header) — Amazon's session has no separate
 * CSRF header, unlike Mercado Livre's.
 */
export function parseCurlCommand(curlCommand: string): ParsedCurlSession | null {
  const cookieHeader = extractCookieHeader(curlCommand);

  if (!cookieHeader) {
    return null;
  }

  return { cookieHeader };
}
