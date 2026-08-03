export type ParsedCurlSession = {
  cookieHeader: string;
  csrfToken: string;
};

function extractCookieHeader(curlCommand: string): string | undefined {
  const match =
    curlCommand.match(/(?:^|\s)(?:-b|--cookie)\s+'([^']*)'/) ??
    curlCommand.match(/(?:^|\s)(?:-b|--cookie)\s+"([^"]*)"/) ??
    curlCommand.match(/(?:^|\s)(?:-H|--header)\s+'[Cc]ookie:\s*([^']*)'/) ??
    curlCommand.match(/(?:^|\s)(?:-H|--header)\s+"[Cc]ookie:\s*([^"]*)"/);
  return match?.[1]?.trim() || undefined;
}

function extractCsrfToken(curlCommand: string): string | undefined {
  const match =
    curlCommand.match(/(?:^|\s)(?:-H|--header)\s+'x-csrf-token:\s*([^']*)'/i) ??
    curlCommand.match(/(?:^|\s)(?:-H|--header)\s+"x-csrf-token:\s*([^"]*)"/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Parses a "Copy as cURL" command captured from the browser DevTools Network
 * tab against Mercado Livre's affiliate hub, extracting the two values the
 * app actually needs (the Cookie header and the x-csrf-token header) so the
 * operator can paste one blob instead of hunting for each value by hand.
 */
export function parseCurlCommand(curlCommand: string): ParsedCurlSession | null {
  const cookieHeader = extractCookieHeader(curlCommand);
  const csrfToken = extractCsrfToken(curlCommand);

  if (!cookieHeader || !csrfToken) {
    return null;
  }

  return { cookieHeader, csrfToken };
}
