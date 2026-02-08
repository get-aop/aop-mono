import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  API_KEY,
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  ensureChangesDir,
  getLocalExecutionsByTaskId,
  getLocalStepExecutionsByTaskId,
  runAopCommand,
  startLocalServer,
  stopLocalServer,
  type TaskInfo,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForLocalStepWithPid,
  waitForRepoInStatus,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

// --- SSE helpers ---

interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
}

interface ParsedSSEData {
  type: "replay" | "log" | "complete";
  lines?: Array<{ stream: string; content: string; timestamp: string }>;
  stream?: string;
  content?: string;
  timestamp?: string;
  status?: string;
}

const parseSSELine = (line: string, event: { id?: string; event?: string; data: string }): void => {
  if (line.startsWith("id:")) event.id = line.slice(3).trim();
  else if (line.startsWith("event:")) event.event = line.slice(6).trim();
  else if (line.startsWith("data:")) {
    event.data = event.data ? `${event.data}\n${line.slice(5).trim()}` : line.slice(5).trim();
  }
};

const parseSSEBlock = (block: string): SSEEvent | null => {
  const event: { id?: string; event?: string; data: string } = { data: "" };
  for (const line of block.split("\n")) parseSSELine(line, event);
  return event.data ? (event as SSEEvent) : null;
};

const parseSSEChunk = (chunk: string): SSEEvent[] =>
  chunk
    .split("\n\n")
    .filter((b) => b.trim().length > 0)
    .map(parseSSEBlock)
    .filter((e): e is SSEEvent => e !== null);

const parseSSEData = (data: string): ParsedSSEData | null => {
  try {
    return JSON.parse(data) as ParsedSSEData;
  } catch {
    return null;
  }
};

interface ReadSSEResult {
  events: ParsedSSEData[];
  lastEventId?: string;
  complete: boolean;
}

type AccumulateAction = "continue" | "complete" | "max_reached";

const accumulateSSEEvents = (
  chunk: string,
  result: ReadSSEResult,
  maxEvents?: number,
): AccumulateAction => {
  for (const evt of parseSSEChunk(chunk)) {
    if (evt.id) result.lastEventId = evt.id;
    const parsed = parseSSEData(evt.data);
    if (!parsed) continue;
    result.events.push(parsed);

    if (parsed.type === "complete") return "complete";
    if (maxEvents && result.events.length >= maxEvents) return "max_reached";
  }
  return "continue";
};

const consumeSSEBody = async (
  body: ReadableStream<Uint8Array>,
  result: ReadSSEResult,
  maxEvents?: number,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (!result.complete) {
      const readResult = await Promise.race([
        reader.read(),
        Bun.sleep(90_000).then(() => ({ done: true, value: undefined }) as const),
      ]);

      if (readResult.done || !readResult.value) break;

      const action = accumulateSSEEvents(
        decoder.decode(readResult.value, { stream: true }),
        result,
        maxEvents,
      );
      if (action === "complete") {
        result.complete = true;
        break;
      }
      if (action === "max_reached") break;
    }
  } finally {
    reader.cancel();
  }
};

const readSSEStream = async (
  url: string,
  options: {
    timeoutMs?: number;
    maxEvents?: number;
    lastEventId?: string;
  } = {},
): Promise<ReadSSEResult> => {
  const { timeoutMs = 120_000, maxEvents, lastEventId } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const result: ReadSSEResult = { events: [], complete: false };

  try {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;

    const res = await fetch(url, { signal: controller.signal, headers });
    expect(res.ok).toBe(true);

    if (res.body) await consumeSSEBody(res.body, result, maxEvents);
  } finally {
    clearTimeout(timer);
  }

  return result;
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// --- Test suite ---

describe("resilient agent lifecycle", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;
  let taskId: string;

  const setupTaskInRepo = async (repoPath: string) => {
    await ensureChangesDir(repoPath);
    const { exitCode } = await runAopCommand(["repo:init", repoPath], undefined, ctx.env);
    expect(exitCode).toBe(0);

    await waitForRepoInStatus(repoPath, { timeout: 10_000, env: ctx.env });
    await copyFixture("resilience-test", repoPath);
    await triggerServerRefresh(ctx.localServerUrl);

    const repoTasks = await waitForTasksInRepo(repoPath, 1, {
      timeout: 30_000,
      pollInterval: 500,
      env: ctx.env,
    });
    expect(repoTasks.length).toBe(1);
    const task = repoTasks[0] as TaskInfo;

    const { exitCode: readyExit } = await runAopCommand(
      ["task:ready", task.id],
      undefined,
      ctx.env,
    );
    expect(readyExit).toBe(0);

    return task;
  };

  const restartLocalServer = async () => {
    await stopLocalServer(ctx.localServer);
    const newServer = await startLocalServer({
      port: ctx.localServerPort,
      dbPath: ctx.dbPath,
      env: {
        AOP_LOCAL_SERVER_URL: ctx.localServerUrl,
        ...(ctx.remoteServerUrl
          ? { AOP_SERVER_URL: ctx.remoteServerUrl, AOP_API_KEY: API_KEY }
          : {}),
      },
    });
    ctx.localServer = newServer;
  };

  beforeAll(async () => {
    ctx = await createTestContext("resilient-lifecycle");
    repo = await createTempRepo("resilience", ctx.reposDir);
  });

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  });

  test(
    "agent PID is tracked and logs written to file",
    async () => {
      const task = await setupTaskInRepo(repo.path);
      taskId = task.id;
      expect(task.status).toBe("DRAFT");

      const stepWithPid = await waitForLocalStepWithPid(taskId, {
        timeout: 60_000,
        pollInterval: 1000,
        dbPath: ctx.dbPath,
      });
      expect(stepWithPid).not.toBeNull();
      if (!stepWithPid) throw new Error("No step execution with PID found");

      expect(stepWithPid.agent_pid).toBeGreaterThan(0);
      expect(stepWithPid.status).toBe("running");

      const logFile = join(aopPaths.logs(), `${stepWithPid.id}.jsonl`);
      let logFileExists = false;
      for (let i = 0; i < 10 && !logFileExists; i++) {
        logFileExists = existsSync(logFile);
        if (!logFileExists) await Bun.sleep(1000);
      }
      expect(logFileExists).toBe(true);

      const executions = getLocalExecutionsByTaskId(taskId, ctx.dbPath);
      expect(executions.length).toBeGreaterThan(0);

      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
        localServerUrl: ctx.localServerUrl,
      });
      expect(completedTask).not.toBeNull();
      if (!completedTask) throw new Error("Task did not complete");
      expect(["DONE", "BLOCKED"]).toContain(completedTask.status);

      await Bun.sleep(2000);
      expect(existsSync(logFile)).toBe(false);
    },
    E2E_TIMEOUT,
  );

  test(
    "SSE streams from log file during execution",
    async () => {
      const repo2 = await createTempRepo("resilience-sse", ctx.reposDir);
      try {
        const task = await setupTaskInRepo(repo2.path);

        const step = await waitForLocalStepWithPid(task.id, {
          timeout: 60_000,
          dbPath: ctx.dbPath,
        });
        expect(step).not.toBeNull();
        if (!step) throw new Error("No step with PID");

        const executions = getLocalExecutionsByTaskId(task.id, ctx.dbPath);
        expect(executions.length).toBeGreaterThan(0);
        const execId = executions[0]?.id;
        expect(execId).toBeDefined();

        const sseResult = await readSSEStream(
          `${ctx.localServerUrl}/api/executions/${execId}/logs`,
        );

        const hasLogData = sseResult.events.some((e) => e.type === "replay" || e.type === "log");
        expect(hasLogData).toBe(true);

        const completeEvent = sseResult.events.find((e) => e.type === "complete");
        if (!completeEvent?.status) throw new Error("No complete event in SSE stream");
        expect(["completed", "failed"]).toContain(completeEvent.status);

        await waitForTask(task.id, ["DONE", "BLOCKED"], {
          timeout: 300_000,
          pollInterval: 2000,
          localServerUrl: ctx.localServerUrl,
        });
      } finally {
        await repo2.cleanup();
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "server restart recovery — agent survives restart",
    async () => {
      const repo3 = await createTempRepo("resilience-restart", ctx.reposDir);
      try {
        const task = await setupTaskInRepo(repo3.path);

        const step = await waitForLocalStepWithPid(task.id, {
          timeout: 60_000,
          dbPath: ctx.dbPath,
        });
        expect(step).not.toBeNull();
        if (!step) throw new Error("No step with PID");

        const agentPid = step.agent_pid;
        expect(agentPid).not.toBeNull();
        expect(agentPid).toBeGreaterThan(0);

        // Restart the local server — agent should survive
        expect(isProcessRunning(agentPid as number)).toBe(true);
        await restartLocalServer();
        await Bun.sleep(3000);

        const taskAfterRestart = await waitForTask(task.id, ["WORKING", "DONE", "BLOCKED"], {
          timeout: 30_000,
          pollInterval: 1000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(taskAfterRestart).not.toBeNull();

        const completedTask = await waitForTask(task.id, ["DONE", "BLOCKED"], {
          timeout: 300_000,
          pollInterval: 2000,
          localServerUrl: ctx.localServerUrl,
        });
        expect(completedTask).not.toBeNull();
        if (!completedTask) throw new Error("Task did not complete after restart");
        expect(["DONE", "BLOCKED"]).toContain(completedTask.status);

        const steps = getLocalStepExecutionsByTaskId(task.id, ctx.dbPath);
        expect(steps.length).toBeGreaterThan(0);
        const finalStep = steps[steps.length - 1];
        if (!finalStep) throw new Error("No step executions found");
        expect(["success", "failure"]).toContain(finalStep.status);
      } finally {
        await repo3.cleanup();
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "SSE resumes after server restart via Last-Event-ID",
    async () => {
      const repo4 = await createTempRepo("resilience-sse-resume", ctx.reposDir);

      try {
        const task = await setupTaskInRepo(repo4.path);

        const step = await waitForLocalStepWithPid(task.id, {
          timeout: 60_000,
          dbPath: ctx.dbPath,
        });
        expect(step).not.toBeNull();
        if (!step) throw new Error("No step with PID");

        const executions = getLocalExecutionsByTaskId(task.id, ctx.dbPath);
        expect(executions.length).toBeGreaterThan(0);
        const execId = executions[0]?.id;
        expect(execId).toBeDefined();

        const firstBatch = await readSSEStream(
          `${ctx.localServerUrl}/api/executions/${execId}/logs`,
          { timeoutMs: 30_000, maxEvents: 3 },
        );

        await restartLocalServer();
        await Bun.sleep(3000);

        const resumed = await readSSEStream(`${ctx.localServerUrl}/api/executions/${execId}/logs`, {
          lastEventId: firstBatch.lastEventId,
        });

        const completeEvent = resumed.events.find((e) => e.type === "complete");
        expect(completeEvent).toBeDefined();

        await waitForTask(task.id, ["DONE", "BLOCKED"], {
          timeout: 300_000,
          pollInterval: 2000,
          localServerUrl: ctx.localServerUrl,
        });
      } finally {
        await repo4.cleanup();
      }
    },
    E2E_TIMEOUT,
  );
});
