import { createHash } from "crypto";

const GRAPHQL_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

export class ShopeeApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "ShopeeApiError";
    this.code = code;
  }
}

type GraphQLErrorBody = {
  message: string;
  path?: string;
  extensions?: { code?: number; message?: string };
};

function signPayload(appId: string, timestamp: number, payload: string, secret: string): string {
  return createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
}

export async function shopeeRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const appId = process.env.SHOPEE_APP_ID;
  if (!appId) {
    throw new Error("SHOPEE_APP_ID is not set");
  }
  const secret = process.env.SHOPEE_APP_SECRET;
  if (!secret) {
    throw new Error("SHOPEE_APP_SECRET is not set");
  }

  const payload = JSON.stringify({ query, variables });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(appId, timestamp, payload, secret);

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new ShopeeApiError(`Shopee API request failed: ${response.status}`);
  }

  const body = (await response.json()) as { data?: T; errors?: GraphQLErrorBody[] };
  if (body.errors && body.errors.length > 0) {
    const [firstError] = body.errors;
    throw new ShopeeApiError(firstError.message, firstError.extensions?.code);
  }

  return body.data as T;
}
