import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { WorktreeInfo } from "@aop/git-manager";
import { GitManager } from "@aop/git-manager";
import { aopPaths, generateTypeId, getLogger } from "@aop/infra";
import type { LLMProvider } from "@aop/llm-provider";
import type { LocalServerContext } from "../../context.ts";
import {
  buildContext,
  buildPromptForExecution,
  cleanupLogFile,
  processAgentCompletion,
} from "../../executor/executor.ts";
import { getProvider } from "../../executor/step-launcher.ts";
import { createTemplateLoader } from "../../prompts/template-loader.ts";
import type { TaskRepository } from "../../task/repository.ts";
import { createStepCommandGenerator } from "../../workflow-engine/step-command-generator.ts";
import type { WorkflowStep } from "../../workflow-engine/types.ts";

const logger = getLogger("linear-import-planner");
const ARTIFACT_POLL_INTERVAL_MS = 250;
const ARTIFACT_STABILITY_WINDOW_MS = 1000;
const PROVIDER_EXIT_GRACE_MS = 1000;

const PLAN_STEP: WorkflowStep = {
  id: "plan_implementation",
  type: "iterate",
  promptTemplate: "plan-implementation.md.hbs",
  maxAttempts: 1,
  signals: [
    {
      name: "PLAN_READY",
      description: "plan.md and numbered subtask docs are written and ready for human approval",
    },
    {
      name: "REQUIRES_INPUT",
      description:
        "need clarification before planning can proceed. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
    },
  ],
  transitions: [],
};

export interface LinearImportPlanner {
  planTasks(params: { taskIds: string[] }): Promise<void>;
}

interface CreateLinearImportPlannerOptions {
  ctx: LocalServerContext;
  provider?: LLMProvider;
  taskRepository?: TaskRepository;
}

export const createLinearImportPlanner = (
  options: CreateLinearImportPlannerOptions,
): LinearImportPlanner => {
  const templateLoader = createTemplateLoader();
  const stepCommandGenerator = createStepCommandGenerator(templateLoader);
  const taskRepository = options.taskRepository ?? options.ctx.taskRepository;

  return {
    planTasks: async ({ taskIds }) => {
      if (taskIds.length === 0) {
        return;
      }

      const provider = options.provider ?? (await getProvider(options.ctx));

      for (const taskId of taskIds) {
        await planTask(taskId, taskRepository, options.ctx, provider, stepCommandGenerator);
      }
    },
  };
};

const planTask = async (
  taskId: string,
  taskRepository: TaskRepository,
  ctx: LocalServerContext,
  provider: LLMProvider,
  stepCommandGenerator: ReturnType<typeof createStepCommandGenerator>,
) => {
  const task = await taskRepository.get(taskId);
  if (!task) {
    throw new Error(`Imported task not found for planning: ${taskId}`);
  }

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) {
    throw new Error(`Repo not found for imported task: ${taskId}`);
  }

  const branch = await getCurrentBranch(repo.path, repo.id);
  const executorCtx = await buildContext(ctx, task, aopPaths.logs());
  const taskDir = join(repo.path, task.change_path);
  await removePlaceholderPlanArtifacts(taskDir);
  const stepCommand = await stepCommandGenerator.generate(PLAN_STEP, generateTypeId("step"), 1, 0);
  const prompt = await buildPromptForExecution({
    executorCtx,
    worktreeInfo: toRepoWorktree(repo.path, branch),
    stepCommand,
    executionId: generateTypeId("exec"),
  });
  const logFilePath = join(executorCtx.logsDir, `linear-import-plan-${task.id}.jsonl`);

  logger.info("Planning imported Linear task {taskId}", {
    taskId: task.id,
    changePath: task.change_path,
    provider: provider.name,
  });

  const runResult = await runPlannerUntilArtifactsReady({
    provider,
    prompt,
    cwd: repo.path,
    logFilePath,
    inactivityTimeoutMs: executorCtx.timeoutSecs * 1000,
    fastMode: executorCtx.fastMode,
    taskDir,
    taskId: task.id,
  });

  if (!(await hasSubstantivePlanningArtifacts(taskDir))) {
    throw new Error(
      `Planning imported task ${getTaskRef(task.change_path)} produced incomplete task docs`,
    );
  }

  if (runResult.completedFromArtifacts) {
    cleanupLogFile(logFilePath);
    return;
  }

  const completion = processAgentCompletion(logFilePath, runResult, stepCommand.signals);
  cleanupLogFile(logFilePath);

  if (completion.status !== "success") {
    throw new Error(`Planning imported task ${getTaskRef(task.change_path)} failed`);
  }
  if (completion.signal === "REQUIRES_INPUT") {
    throw new Error(`Planning imported task ${getTaskRef(task.change_path)} requires user input`);
  }
};

const getCurrentBranch = async (repoPath: string, repoId: string): Promise<string> => {
  const gitManager = new GitManager({ repoPath, repoId });
  await gitManager.init();
  const { current } = await gitManager.listLocalBranches();
  return current || (await gitManager.getDefaultBranch());
};

const toRepoWorktree = (repoPath: string, branch: string): WorktreeInfo => ({
  path: repoPath,
  branch,
  baseBranch: branch,
  baseCommit: "",
});

const runPlannerUntilArtifactsReady = async (params: {
  provider: LLMProvider;
  prompt: string;
  cwd: string;
  logFilePath: string;
  inactivityTimeoutMs: number;
  fastMode: boolean;
  taskDir: string;
  taskId: string;
}): Promise<RunResultWithArtifacts> => {
  let spawnedPid: number | undefined;
  const runPromise = params.provider.run({
    prompt: params.prompt,
    cwd: params.cwd,
    logFilePath: params.logFilePath,
    inactivityTimeoutMs: params.inactivityTimeoutMs,
    fastMode: params.fastMode,
    env: {
      AOP_TASK_ID: params.taskId,
      AOP_IMPORT_MODE: "linear-plan",
    },
    onSpawn: (pid) => {
      spawnedPid = pid;
    },
  });

  const winner = await Promise.race([
    runPromise.then((result) => ({ type: "provider" as const, result })),
    waitForSubstantiveArtifacts(params.taskDir, params.inactivityTimeoutMs).then(() => ({
      type: "artifacts" as const,
    })),
  ]);

  if (winner.type === "provider") {
    return winner.result;
  }

  await terminateProcessTree(spawnedPid);
  await settleProviderRun(runPromise, PROVIDER_EXIT_GRACE_MS);

  logger.info("Planning completed from written task artifacts before provider exit", {
    taskId: params.taskId,
    pid: spawnedPid,
  });

  return {
    exitCode: 0,
    pid: spawnedPid,
    completedFromArtifacts: true,
  };
};

const hasSubstantivePlanningArtifacts = async (taskDir: string): Promise<boolean> => {
  const planFile = Bun.file(join(taskDir, "plan.md"));
  if (!(await planFile.exists())) {
    return false;
  }

  const planContent = await planFile.text();
  if (!planContent.includes("## Summary") || !planContent.includes("## Verification")) {
    return false;
  }

  const entries = await readdir(taskDir);
  const subtaskFile = entries.find((file) => /^\d{3}-.*\.md$/.test(file));
  if (!subtaskFile) {
    return false;
  }

  const subtaskContent = await Bun.file(join(taskDir, subtaskFile)).text();
  return (
    hasSectionContent(subtaskContent, "Description") && hasSectionContent(subtaskContent, "Context")
  );
};

const removePlaceholderPlanArtifacts = async (taskDir: string): Promise<void> => {
  const planPath = join(taskDir, "plan.md");
  const planExists = await Bun.file(planPath).exists();
  if (!planExists) {
    return;
  }

  const planContent = await Bun.file(planPath).text();
  if (!isPlaceholderPlan(planContent)) {
    return;
  }

  const entries = await readdir(taskDir);
  await rm(planPath, { force: true });
  await Promise.all(
    entries
      .filter((file) => /^\d{3}-.*\.md$/.test(file))
      .map((file) => rm(join(taskDir, file), { force: true })),
  );
};

const isPlaceholderPlan = (planContent: string): boolean =>
  planContent.includes("## Subtasks") &&
  !planContent.includes("## Summary") &&
  !planContent.includes("## Verification");

const hasSectionContent = (markdown: string, section: string): boolean => {
  const pattern = new RegExp(`### ${section}\\s+([\\s\\S]*?)(?:\\n### |$)`);
  const match = markdown.match(pattern);
  return typeof match?.[1] === "string" && match[1].trim().length > 0;
};

type RunResultWithArtifacts = {
  exitCode: number;
  pid?: number;
  sessionId?: string;
  timedOut?: boolean;
  completedFromArtifacts?: boolean;
};

const waitForSubstantiveArtifacts = async (taskDir: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await hasSubstantivePlanningArtifacts(taskDir)) {
      await Bun.sleep(ARTIFACT_STABILITY_WINDOW_MS);
      if (await hasSubstantivePlanningArtifacts(taskDir)) {
        return;
      }
    }

    await Bun.sleep(ARTIFACT_POLL_INTERVAL_MS);
  }
};

const settleProviderRun = async (
  runPromise: Promise<RunResultWithArtifacts>,
  timeoutMs: number,
): Promise<void> => {
  await Promise.race([
    runPromise.catch(() => undefined).then(() => undefined),
    Bun.sleep(timeoutMs),
  ]);
};

const terminateProcessTree = async (pid: number | undefined): Promise<void> => {
  if (!pid) {
    return;
  }

  trySignal(pid, "SIGTERM");
  await Bun.sleep(250);

  if (isProcessRunning(pid)) {
    trySignal(pid, "SIGKILL");
  }
};

const trySignal = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited.
    }
  }
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const getTaskRef = (changePath: string): string => changePath.split("/").pop() ?? changePath;
