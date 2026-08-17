const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_BASE_URL = "https://creatorsapi.amazon";
const MARKETPLACE = "www.amazon.com.br";
const REQUEST_TIMEOUT_MS = 10_000;

export class AmazonCreatorsApiError extends Error {
  rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "AmazonCreatorsApiError";
    this.rateLimited = rateLimited;
  }
}

export async function fetchAccessToken(): Promise<string> {
  const clientId = process.env.AMAZON_CREATORS_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CREATORS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AMAZON_CREATORS_CLIENT_ID/SECRET is not set");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "creatorsapi::default",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AmazonCreatorsApiError(`Amazon token request failed: ${response.status}`);
  }

  const data = await response.json();
  if (typeof data?.access_token !== "string") {
    throw new AmazonCreatorsApiError("Amazon token response missing access_token");
  }
  return data.access_token;
}
