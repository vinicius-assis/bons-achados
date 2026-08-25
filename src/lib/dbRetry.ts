import { Prisma } from "@prisma/client";

// Neon's compute suspends when idle; the connection that wakes it can fail
// once with P1001 before the database finishes coming back up. Retrying a
// couple of times rides through that window instead of surfacing a 500.
const RETRYABLE_CODES = new Set(["P1001", "P1002", "P1017"]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

function isRetryableError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code);
}

export async function withDbRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableError(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("unreachable");
}
