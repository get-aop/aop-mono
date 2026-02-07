import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createTaskCommand } from "./create-task.ts";

const mockFetchServer = mock();
const mockRequireServer = mock(async () => undefined);
const mockCreateInterface = mock();
const mockWriteStdout = mock((_chunk: string) => undefined);
const mockExit = mock((code?: number) => {
  throw new Error(`process.exit:${code ?? 0}`);
});
const spinnerStops: Array<ReturnType<typeof mock>> = [];
const mockCreateSpinner = mock((_label: string) => {
  const stop = mock(() => undefined);
  spinnerStops.push(stop);
  return { stop };
});
const logger = {
  debug: mock(async () => undefined),
  error: mock(async () => undefined),
  info: mock(async () => undefined),
  warn: mock(async () => undefined),
};

let signalHandlers: Partial<Record<NodeJS.Signals, (...args: unknown[]) => unknown>>;
let registeredHandlers: Array<{ event: NodeJS.Signals; listener: (...args: unknown[]) => unknown }>;

const makeReadline = (answers: string[]) => {
  const question = mock((_: string, cb: (answer: string) => void) => {
    cb(answers.shift() ?? "");
  });
  const close = mock(() => undefined);
  return {
    question,
    close,
  };
};

const makeRequirements = () => ({
  title: "Improve task creation flow",
  description: "Generate better scoped requirements",
  requirements: ["Collect user intent", "Generate structured requirements"],
  acceptanceCriteria: ["Questions are asked", "Draft is generated"],
});

const createRuntime = () => {
  return {
    createInterface: mockCreateInterface,
    createSpinner: mockCreateSpinner,
    cwd: () => process.cwd(),
    exit: mockExit as unknown as typeof process.exit,
    fetchServer: mockFetchServer,
    logger,
    offSignal: mock((event: NodeJS.Signals) => {
      delete signalHandlers[event];
      return process;
    }) as unknown as typeof process.off,
    onSignal: mock((event: NodeJS.Signals, listener: (...args: unknown[]) => unknown) => {
      signalHandlers[event] = listener;
      registeredHandlers.push({ event, listener });
      return process;
    }) as unknown as typeof process.on,
    requireServer: mockRequireServer,
    writeStdout: mockWriteStdout,
  };
};

beforeEach(() => {
  mockFetchServer.mockReset();
  mockRequireServer.mockReset();
  mockRequireServer.mockResolvedValue(undefined);
  mockCreateSpinner.mockClear();
  mockCreateInterface.mockReset();
  mockWriteStdout.mockReset();
  mockExit.mockReset();
  logger.debug.mockReset();
  logger.error.mockReset();
  logger.info.mockReset();
  logger.warn.mockReset();
  spinnerStops.length = 0;
  signalHandlers = {};
  registeredHandlers = [];
  mockExit.mockImplementation((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  });
});

describe("createTaskCommand", () => {
  test("runs full interactive flow, transforms answers, and finalizes without creating a change", async () => {
    const runtime = createRuntime();
    const rl = makeReadline(["Build release flow", "2", "1, custom", "  free text  ", "n"]);
    mockCreateInterface.mockReturnValue(rl as never);

    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "question",
          sessionId: "session-1",
          question: {
            id: "q-1",
            header: "Scope",
            question: "Which scope?",
            options: [{ label: "Option A", description: "Fast path" }, { label: "Option B" }],
          },
          questionCount: 1,
          maxQuestions: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "question",
          sessionId: "session-1",
          assistantOutput: "   ",
          question: {
            id: "q-2",
            question: "Pick priorities",
            multiSelect: true,
            options: [{ label: "Red" }, { label: "Blue" }],
          },
          questionCount: 2,
          maxQuestions: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "question",
          sessionId: "session-1",
          question: {
            id: "q-3",
            question: "Any extra context?",
            options: [],
          },
          questionCount: 3,
          maxQuestions: 3,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "completed",
          sessionId: "session-1",
          assistantOutput: "Draft requirements prepared",
          requirements: makeRequirements(),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "success",
          sessionId: "session-1",
          requirements: makeRequirements(),
          warning: "Review required",
          draftPath: "/tmp/requirements.md",
        },
      });

    await createTaskCommand(undefined, {}, runtime);

    expect(mockRequireServer).toHaveBeenCalledTimes(1);
    expect(mockFetchServer).toHaveBeenCalledTimes(5);

    expect(mockFetchServer).toHaveBeenNthCalledWith(1, "/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Build release flow", cwd: process.cwd() }),
    });
    expect(mockFetchServer).toHaveBeenNthCalledWith(2, "/api/create-task/session-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Option B" }),
    });
    expect(mockFetchServer).toHaveBeenNthCalledWith(3, "/api/create-task/session-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Red, custom" }),
    });
    expect(mockFetchServer).toHaveBeenNthCalledWith(4, "/api/create-task/session-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "free text" }),
    });
    expect(mockFetchServer).toHaveBeenNthCalledWith(5, "/api/create-task/session-1/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createChange: false }),
    });

    const writes = mockWriteStdout.mock.calls.map((args) => String(args[0] ?? ""));
    expect(writes.some((chunk) => chunk.includes("Question 1/3 [Scope]: Which scope?"))).toBe(true);
    expect(writes.some((chunk) => chunk.includes("1. Option A - Fast path"))).toBe(true);
    expect(
      writes.some((chunk) =>
        chunk.includes("(Enter comma-separated numbers, or type a custom response)"),
      ),
    ).toBe(true);
    expect(writes.some((chunk) => chunk.includes("Draft requirements prepared"))).toBe(true);

    expect(spinnerStops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    expect(runtime.offSignal).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(runtime.offSignal).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  test("exits when description is empty", async () => {
    const runtime = createRuntime();
    const rl = makeReadline(["   "]);
    mockCreateInterface.mockReturnValue(rl as never);

    await expect(createTaskCommand(undefined, {}, runtime)).rejects.toThrow("process.exit:1");
    expect(mockFetchServer).not.toHaveBeenCalled();
  });

  test("prints assistant output and exits on server error in debug mode", async () => {
    const runtime = createRuntime();
    const rl = makeReadline([]);
    mockCreateInterface.mockReturnValue(rl as never);

    mockFetchServer.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: {
        error: "LLM session failed",
        assistantOutput: "Need more detail before proceeding",
      },
    });

    await expect(createTaskCommand("Build release flow", { debug: true }, runtime)).rejects.toThrow(
      "process.exit:1",
    );

    const writes = mockWriteStdout.mock.calls.map((args) => String(args[0] ?? ""));
    expect(writes.some((chunk) => chunk.includes("Need more detail before proceeding"))).toBe(true);
    expect(spinnerStops[0]).toBeDefined();
    expect(spinnerStops[0]?.mock.calls.length).toBe(2);
  });

  test("creates change when user confirms yes", async () => {
    const runtime = createRuntime();
    const rl = makeReadline(["yes"]);
    mockCreateInterface.mockReturnValue(rl as never);

    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "completed",
          sessionId: "session-2",
          requirements: makeRequirements(),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "success",
          sessionId: "session-2",
          requirements: makeRequirements(),
          changeName: "release-flow-improvements",
        },
      });

    await createTaskCommand("Build release flow", {}, runtime);

    expect(mockFetchServer).toHaveBeenNthCalledWith(2, "/api/create-task/session-2/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createChange: true }),
    });
  });

  test("stops spinner and rethrows errors from fetch", async () => {
    const runtime = createRuntime();
    const rl = makeReadline([]);
    mockCreateInterface.mockReturnValue(rl as never);
    mockFetchServer.mockRejectedValueOnce(new Error("network down"));

    await expect(createTaskCommand("Build release flow", {}, runtime)).rejects.toThrow(
      "network down",
    );

    expect(mockCreateSpinner).toHaveBeenCalledWith("Brainstorming");
    expect(spinnerStops[0]?.mock.calls.length).toBe(1);
  });

  test("cancel handler posts to cancel endpoint when a session exists", async () => {
    const runtime = createRuntime();
    const rl = makeReadline(["n"]);
    mockCreateInterface.mockReturnValue(rl as never);
    mockFetchServer.mockResolvedValue({ ok: true, data: { status: "ok" } });
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "completed",
          sessionId: "session-cancel",
          requirements: makeRequirements(),
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "success",
          sessionId: "session-cancel",
          requirements: makeRequirements(),
        },
      });

    await createTaskCommand("Build release flow", {}, runtime);

    const sigint = registeredHandlers.find((entry) => entry.event === "SIGINT")?.listener as
      | (() => Promise<void>)
      | undefined;
    expect(sigint).toBeDefined();
    if (sigint) {
      await expect(sigint()).rejects.toThrow("process.exit:130");
    }

    expect(mockFetchServer).toHaveBeenCalledWith("/api/create-task/session-cancel/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(mockExit).toHaveBeenCalledWith(130);
  });
});
