import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTicker, type Ticker } from "./ticker.ts";

describe("createTicker", () => {
  let ticker: Ticker;
  let tickCount: number;
  let tickPromiseResolve: () => void;

  beforeEach(() => {
    tickCount = 0;
  });

  afterEach(() => {
    ticker?.stop();
  });

  test("starts in stopped state", () => {
    ticker = createTicker(async () => {}, { intervalMs: 100 });
    expect(ticker.isRunning()).toBe(false);
  });

  test("isRunning returns true after start", () => {
    ticker = createTicker(async () => {}, { intervalMs: 100 });
    ticker.start();
    expect(ticker.isRunning()).toBe(true);
  });

  test("isRunning returns false after stop", () => {
    ticker = createTicker(async () => {}, { intervalMs: 100 });
    ticker.start();
    ticker.stop();
    expect(ticker.isRunning()).toBe(false);
  });

  test("calls onTick after interval", async () => {
    const tickPromise = new Promise<void>((resolve) => {
      tickPromiseResolve = resolve;
    });

    ticker = createTicker(
      async () => {
        tickCount++;
        tickPromiseResolve();
      },
      { intervalMs: 10 },
    );

    ticker.start();
    await tickPromise;

    expect(tickCount).toBeGreaterThanOrEqual(1);
  });

  test("calls onTick multiple times", async () => {
    let resolveSecondTick: () => void;
    const secondTickPromise = new Promise<void>((resolve) => {
      resolveSecondTick = resolve;
    });

    ticker = createTicker(
      async () => {
        tickCount++;
        if (tickCount >= 2) {
          resolveSecondTick();
        }
      },
      { intervalMs: 10 },
    );

    ticker.start();
    await secondTickPromise;

    expect(tickCount).toBeGreaterThanOrEqual(2);
  });

  test("stops calling onTick after stop", async () => {
    const tickPromise = new Promise<void>((resolve) => {
      tickPromiseResolve = resolve;
    });

    ticker = createTicker(
      async () => {
        tickCount++;
        tickPromiseResolve();
      },
      { intervalMs: 10 },
    );

    ticker.start();
    await tickPromise;
    ticker.stop();

    const countAfterStop = tickCount;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(tickCount).toBe(countAfterStop);
  });

  test("handles onTick errors gracefully", async () => {
    let errorThrown = false;
    let resolveAfterError: () => void;
    const afterErrorPromise = new Promise<void>((resolve) => {
      resolveAfterError = resolve;
    });

    ticker = createTicker(
      async () => {
        tickCount++;
        if (tickCount === 1) {
          errorThrown = true;
          throw new Error("Test error");
        }
        if (tickCount >= 2) {
          resolveAfterError();
        }
      },
      { intervalMs: 10 },
    );

    ticker.start();
    await afterErrorPromise;

    expect(errorThrown).toBe(true);
    expect(tickCount).toBeGreaterThanOrEqual(2);
    expect(ticker.isRunning()).toBe(true);
  });

  test("ignores second start call when already running", () => {
    ticker = createTicker(async () => {}, { intervalMs: 100 });

    ticker.start();
    expect(ticker.isRunning()).toBe(true);

    ticker.start();
    expect(ticker.isRunning()).toBe(true);
  });

  test("stop is idempotent", () => {
    ticker = createTicker(async () => {}, { intervalMs: 100 });

    ticker.start();
    ticker.stop();
    expect(ticker.isRunning()).toBe(false);

    ticker.stop();
    expect(ticker.isRunning()).toBe(false);
  });

  test("can restart after stopping", async () => {
    const tickPromise = new Promise<void>((resolve) => {
      tickPromiseResolve = resolve;
    });

    ticker = createTicker(
      async () => {
        tickCount++;
        tickPromiseResolve();
      },
      { intervalMs: 10 },
    );

    ticker.start();
    await tickPromise;
    ticker.stop();

    tickCount = 0;
    const restartPromise = new Promise<void>((resolve) => {
      tickPromiseResolve = resolve;
    });

    ticker.start();
    await restartPromise;

    expect(tickCount).toBeGreaterThanOrEqual(1);
  });
});
