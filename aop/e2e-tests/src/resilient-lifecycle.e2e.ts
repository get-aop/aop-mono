// Prerequisites: `bun dev` must be running before executing this test

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  API_KEY,
  cleanupTestRepos,
  copyFixture,
  createTempRepo,
  DEFAULT_LOCAL_SERVER_URL,
  type E2EServerContext,
  ensureChangesDir,
  getLocalExecutionsByTaskId,
  getLocalStepExecutionsByTaskId,
  isLocalServerRunning,
  runAopCommand,
  SERVER_URL,
  setupE2ETestDir,
  startE2EServer,
  startLocalServer,
  stopE2EServer,
  stopLocalServer,
  type TaskInfo,
  type TempRepoResult,
  triggerServerRefresh,
  waitForLocalStepWithPid,
  waitForRepoInStatus,
  waitForTask,
  waitForTasksInRepo,
} from "./helpers";
import { checkDevEnvironment } from "./helpers/server";

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

const configureServerConnection = async () => {
  await runAopCommand(["config:set", "server_url", SERVER_URL]);
  await runAopCommand(["config:set", "api_key", API_KEY]);
};

const setupTaskInRepo = async (repoPath: string, serverUrl?: string) => {
  await ensureChangesDir(repoPath);
  const { exitCode } = await runAopCommand(["repo:init", repoPath]);
  expect(exitCode).toBe(0);

  await waitForRepoInStatus(repoPath, { timeout: 10_000 });
  await copyFixture("resilience-test", repoPath);
  await triggerServerRefresh(serverUrl);

  const repoTasks = await waitForTasksInRepo(repoPath, 1, {
    timeout: 30_000,
    pollInterval: 500,
  });
  expect(repoTasks.length).toBe(1);
  const task = repoTasks[0] as TaskInfo;

  const { exitCode: readyExit } = await runAopCommand(["task:ready", task.id]);
  expect(readyExit).toBe(0);

  return task;
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const restartServerAndVerifyRecovery = async (
  taskId: string,
  agentPid: number,
  setLocalServer: (s: Awaited<ReturnType<typeof startLocalServer>>) => void,
) => {
  // Verify the Claude process is still alive (fire-and-forget)
  expect(isProcessRunning(agentPid)).toBe(true);

  // Restart the server — recovery should reattach to the running agent
  const newServer = await startLocalServer();
  setLocalServer(newServer);
  await configureServerConnection();

  // Allow recovery to complete
  await Bun.sleep(3000);

  // Task should still be WORKING (agent was reattached) or already DONE
  const taskAfterRestart = await waitForTask(taskId, ["WORKING", "DONE", "BLOCKED"], {
    timeout: 30_000,
    pollInterval: 1000,
  });
  expect(taskAfterRestart).not.toBeNull();

  const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
    timeout: 300_000,
    pollInterval: 2000,
  });
  expect(completedTask).not.toBeNull();
  if (!completedTask) throw new Error("Task did not complete after restart");
  expect(["DONE", "BLOCKED"]).toContain(completedTask.status);

  // Verify execution logs were persisted
  const steps = getLocalStepExecutionsByTaskId(taskId);
  expect(steps.length).toBeGreaterThan(0);
  const finalStep = steps[steps.length - 1];
  if (!finalStep) throw new Error("No step executions found");
  expect(["success", "failure"]).toContain(finalStep.status);
};

// --- Test suite ---

describe("resilient agent lifecycle", () => {
  let repo: TempRepoResult;
  let context: E2EServerContext;
  let wasAlreadyRunning = false;
  let taskId: string;

  beforeAll(async () => {
    const envCheck = await checkDevEnvironment();
    if (!envCheck.ready) {
      throw new Error(
        `Dev environment not ready: ${envCheck.reason}\n` +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    const localRunning = await isLocalServerRunning();
    if (!localRunning) {
      throw new Error(
        "Local server not running.\n" +
          "Run 'bun dev' in a separate terminal before running E2E tests.",
      );
    }

    await setupE2ETestDir();
    repo = await createTempRepo("resilience");
  });

  afterAll(async () => {
    if (context) {
      await stopE2EServer(context, wasAlreadyRunning);
    }
    await repo.cleanup();
    await cleanupTestRepos();
  });

  test(
    "agent PID is tracked and logs written to file",
    async () => {
      const serverResult = await startE2EServer();
      context = serverResult.context;
      wasAlreadyRunning = serverResult.wasAlreadyRunning;
      expect(serverResult.success).toBe(true);
      expect(await isLocalServerRunning()).toBe(true);

      // Always ensure correct server connection (previous runs may have left stale settings)
      await configureServerConnection();

      const task = await setupTaskInRepo(repo.path);
      taskId = task.id;
      expect(task.status).toBe("DRAFT");

      // Wait for agent to start and PID to be recorded
      const stepWithPid = await waitForLocalStepWithPid(taskId, {
        timeout: 60_000,
        pollInterval: 1000,
      });
      expect(stepWithPid).not.toBeNull();
      if (!stepWithPid) throw new Error("No step execution with PID found");

      expect(stepWithPid.agent_pid).toBeGreaterThan(0);
      expect(stepWithPid.status).toBe("running");

      // Verify log file exists on disk (poll briefly as agent may not have written yet)
      const logFile = join(aopPaths.logs(), `${stepWithPid.id}.jsonl`);
      let logFileExists = false;
      for (let i = 0; i < 10 && !logFileExists; i++) {
        logFileExists = existsSync(logFile);
        if (!logFileExists) await Bun.sleep(1000);
      }
      expect(logFileExists).toBe(true);

      const executions = getLocalExecutionsByTaskId(taskId);
      expect(executions.length).toBeGreaterThan(0);

      // Wait for task completion (BLOCKED is acceptable — we're testing lifecycle, not agent success)
      const completedTask = await waitForTask(taskId, ["DONE", "BLOCKED"], {
        timeout: 300_000,
        pollInterval: 2000,
      });
      expect(completedTask).not.toBeNull();
      if (!completedTask) throw new Error("Task did not complete");
      expect(["DONE", "BLOCKED"]).toContain(completedTask.status);

      // After completion, log file should be cleaned up (persisted to DB)
      await Bun.sleep(2000);
      expect(existsSync(logFile)).toBe(false);
    },
    E2E_TIMEOUT,
  );

  test(
    "SSE streams from log file during execution",
    async () => {
      const repo2 = await createTempRepo("resilience-sse");
      try {
        const task = await setupTaskInRepo(repo2.path);

        const step = await waitForLocalStepWithPid(task.id, { timeout: 60_000 });
        expect(step).not.toBeNull();
        if (!step) throw new Error("No step with PID");

        const executions = getLocalExecutionsByTaskId(task.id);
        expect(executions.length).toBeGreaterThan(0);
        const execId = executions[0]?.id;
        expect(execId).toBeDefined();

        const localServerUrl = context.localServer?.url ?? DEFAULT_LOCAL_SERVER_URL;
        const sseResult = await readSSEStream(`${localServerUrl}/api/executions/${execId}/logs`);

        const hasLogData = sseResult.events.some((e) => e.type === "replay" || e.type === "log");
        expect(hasLogData).toBe(true);

        const completeEvent = sseResult.events.find((e) => e.type === "complete");
        if (!completeEvent?.status) throw new Error("No complete event in SSE stream");
        expect(["completed", "failed"]).toContain(completeEvent.status);

        await waitForTask(task.id, ["DONE", "BLOCKED"], { timeout: 300_000, pollInterval: 2000 });
      } finally {
        await repo2.cleanup();
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "server restart recovery — agent survives restart",
    async () => {
      // Cannot restart an externally managed server
      if (wasAlreadyRunning) return;

      // Stop the existing server from startE2EServer
      if (context.localServer) {
        await stopLocalServer(context.localServer);
        context.localServer = null;
      }

      const localServer = await startLocalServer();
      context.localServer = localServer;
      await configureServerConnection();

      const repo3 = await createTempRepo("resilience-restart");
      try {
        const task = await setupTaskInRepo(repo3.path, localServer.url);

        const step = await waitForLocalStepWithPid(task.id, { timeout: 60_000 });
        expect(step).not.toBeNull();
        if (!step) throw new Error("No step with PID");

        const agentPid = step.agent_pid;
        expect(agentPid).not.toBeNull();
        expect(agentPid).toBeGreaterThan(0);

        await stopLocalServer(localServer);
        await restartServerAndVerifyRecovery(task.id, agentPid as number, (s) => {
          context.localServer = s;
        });
      } finally {
        await repo3.cleanup();
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "SSE resumes after server restart via Last-Event-ID",
    async () => {
      if (wasAlreadyRunning) return;

      // Ensure we have a server running
      if (!context.localServer || !(await isLocalServerRunning(context.localServer.url))) {
        context.localServer = await startLocalServer();
        await configureServerConnection();
      }

      let localServer = context.localServer;
      const repo4 = await createTempRepo("resilience-sse-resume");

      try {
        const task = await setupTaskInRepo(repo4.path, localServer.url);

        const step = await waitForLocalStepWithPid(task.id, { timeout: 60_000 });
        expect(step).not.toBeNull();
        if (!step) throw new Error("No step with PID");

        const executions = getLocalExecutionsByTaskId(task.id);
        expect(executions.length).toBeGreaterThan(0);
        const execId = executions[0]?.id;
        expect(execId).toBeDefined();

        // Read a few initial events then disconnect
        const firstBatch = await readSSEStream(`${localServer.url}/api/executions/${execId}/logs`, {
          timeoutMs: 30_000,
          maxEvents: 3,
        });

        // Kill and restart server
        await stopLocalServer(localServer);
        localServer = await startLocalServer();
        context.localServer = localServer;
        await configureServerConnection();
        await Bun.sleep(3000);

        // Reconnect with Last-Event-ID to resume from where we left off
        const resumed = await readSSEStream(`${localServer.url}/api/executions/${execId}/logs`, {
          lastEventId: firstBatch.lastEventId,
        });

        // The resumed stream should eventually have a complete event
        const completeEvent = resumed.events.find((e) => e.type === "complete");
        expect(completeEvent).toBeDefined();

        await waitForTask(task.id, ["DONE", "BLOCKED"], { timeout: 300_000, pollInterval: 2000 });
      } finally {
        await repo4.cleanup();
      }
    },
    E2E_TIMEOUT,
  );
});
