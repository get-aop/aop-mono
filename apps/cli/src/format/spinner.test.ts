import { afterEach, describe, expect, mock, test } from "bun:test";

const spinnerModulePath = "./spinner.ts?spinner-test";
const { createSpinner } = (await import(spinnerModulePath)) as typeof import("./spinner.ts");

const originalWrite = process.stdout.write;

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe("createSpinner", () => {
  test("writes spinner frames with label and elapsed time", () => {
    const writtenChunks: string[] = [];
    let tick: (() => void) | undefined;
    const write = mock((chunk: string) => {
      writtenChunks.push(chunk);
    });
    const now = mock(() => 0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(120);
    const setIntervalMock = mock(
      (
        callback: (...args: unknown[]) => void,
        _delay?: number,
        ..._args: unknown[]
      ): ReturnType<typeof setInterval> => {
        tick = () => callback();
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
    ) as unknown as typeof globalThis.setInterval;

    const spinner = createSpinner("Loading", {
      clearInterval: mock(() => undefined),
      now,
      setInterval: setIntervalMock,
      write,
    });
    tick?.();
    spinner.stop();

    const frameOutput = writtenChunks.find((chunk) => chunk.includes("Loading"));
    expect(frameOutput).toBeDefined();
    expect(frameOutput).toContain("(0s)");
  });

  test("stop clears the line", () => {
    const write = mock(() => undefined);
    const clearIntervalMock = mock(() => undefined);
    const setIntervalMock = mock(
      (
        _callback: (...args: unknown[]) => void,
        _delay?: number,
        ..._args: unknown[]
      ): ReturnType<typeof setInterval> => 42 as unknown as ReturnType<typeof setInterval>,
    ) as unknown as typeof globalThis.setInterval;

    const spinner = createSpinner("Test", {
      clearInterval: clearIntervalMock,
      setInterval: setIntervalMock,
      write,
    });
    spinner.stop();

    expect(clearIntervalMock).toHaveBeenCalledWith(42);
    expect(write).toHaveBeenCalledWith("\r\x1b[K");
  });

  test("uses default write implementation when no write dependency is provided", () => {
    process.stdout.write = mock(() => true) as unknown as typeof process.stdout.write;
    const clearIntervalMock = mock(() => undefined);
    const setIntervalMock = mock(
      (
        _callback: (...args: unknown[]) => void,
        _delay?: number,
        ..._args: unknown[]
      ): ReturnType<typeof setInterval> => 7 as unknown as ReturnType<typeof setInterval>,
    ) as unknown as typeof globalThis.setInterval;

    const spinner = createSpinner("Default write path", {
      clearInterval: clearIntervalMock,
      setInterval: setIntervalMock,
    });
    spinner.stop();

    expect(process.stdout.write).toHaveBeenCalledWith("\r\x1b[K");
  });
});
