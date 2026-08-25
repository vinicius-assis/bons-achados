import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { withDbRetry } from "@/lib/dbRetry";

function connectionError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
    code: "P1001",
    clientVersion: "6.19.3",
  });
}

describe("withDbRetry", () => {
  it("retries a connection error and returns the eventual result", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw connectionError();
      return "ok";
    });

    const promise = withDbRetry(operation);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    vi.useRealTimers();
  });

  it("rethrows a non-connection error without retrying", async () => {
    const operation = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(withDbRetry(operation)).rejects.toThrow("boom");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("gives up and rethrows after exhausting retries on a connection error", async () => {
    vi.useFakeTimers();
    const operation = vi.fn(async () => {
      throw connectionError();
    });

    const promise = withDbRetry(operation);
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("Can't reach database server");
    expect(operation).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
