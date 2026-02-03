import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { findRepoRoot, GitManager } from "@aop/git-manager";
import { generateTypeId, getLogger, type Logger } from "@aop/infra";
import { ClaudeCodeProvider, createOutputLogger } from "@aop/llm-provider";
import Handlebars from "handlebars";
import type { CommandContext } from "../../context.ts";
import type { Task } from "../../db/schema.ts";
import type { RepoRepository } from "../../repos/repository.ts";
import type { TaskRepository } from "../repository.ts";

export type RunTaskResult =
  | { success: true; task: Task; exitCode: number; finalStatus: "DONE" | "BLOCKED" }
  | { success: false; error: RunTaskError };

export type RunTaskError =
  | { code: "NOT_FOUND"; message: string }
  | { code: "ALREADY_WORKING"; taskId: string }
  | { code: "PATH_NOT_FOUND"; path: string }
  | { code: "NO_REPO_ROOT" };

interface RunContext {
  task: Task;
  repoPath: string;
  absoluteChangePath: string;
}

type ResolveRunContextResult =
  | ({ success: true } & RunContext)
  | { success: false; error: RunTaskError };

const logger = getLogger("aop", "tasks", "handlers");
const agentOutputHandler = createOutputLogger({ categories: ["aop", "agent"] });

export const runTask = async (
  ctx: CommandContext,
  taskIdOrChangePath: string,
): Promise<RunTaskResult> => {
  const { taskRepository, repoRepository } = ctx;

  const runCtx = await resolveRunContext(taskRepository, repoRepository, taskIdOrChangePath);
  if (!runCtx.success) {
    return { success: false, error: runCtx.error };
  }

  const { task, repoPath, absoluteChangePath } = runCtx;
  const log = logger.with({ taskId: task.id, repoPath });

  if (task.status === "WORKING") {
    return { success: false, error: { code: "ALREADY_WORKING", taskId: task.id } };
  }

  log.info("Starting task");
  log.info("Change: {changePath}", { changePath: task.change_path });

  await taskRepository.update(task.id, { status: "WORKING" });

  const gitManager = new GitManager({ repoPath });
  await gitManager.init();

  const worktreeInfo = await createWorktree(log, gitManager, task.id);
  await taskRepository.update(task.id, { worktree_path: worktreeInfo.path });

  const prompt = await buildAgentPrompt(absoluteChangePath, task.id);
  const result = await runAgent(log, worktreeInfo.path, prompt);

  const finalStatus = result.exitCode === 0 ? "DONE" : "BLOCKED";
  await taskRepository.update(task.id, { status: finalStatus });

  return { success: true, task, exitCode: result.exitCode, finalStatus };
};

const resolveRunContext = async (
  taskRepository: TaskRepository,
  repoRepository: RepoRepository,
  taskIdOrChangePath: string,
): Promise<ResolveRunContextResult> => {
  const task = await taskRepository.get(taskIdOrChangePath);
  if (task) {
    return resolveFromTask(repoRepository, task);
  }

  return resolveFromChangePath(taskRepository, repoRepository, taskIdOrChangePath);
};

const resolveFromTask = async (
  repoRepository: RepoRepository,
  task: Task,
): Promise<ResolveRunContextResult> => {
  const repo = await repoRepository.getById(task.repo_id);
  if (!repo) {
    return {
      success: false,
      error: { code: "NOT_FOUND", message: `Repository not found for task: ${task.id}` },
    };
  }

  const absoluteChangePath = join(repo.path, task.change_path);
  if (!existsSync(absoluteChangePath)) {
    return { success: false, error: { code: "PATH_NOT_FOUND", path: absoluteChangePath } };
  }

  return { success: true, task, repoPath: repo.path, absoluteChangePath };
};

const resolveFromChangePath = async (
  taskRepository: TaskRepository,
  repoRepository: RepoRepository,
  changePath: string,
): Promise<ResolveRunContextResult> => {
  const absoluteChangePath = isAbsolute(changePath)
    ? changePath
    : resolve(process.cwd(), changePath);

  if (!existsSync(absoluteChangePath)) {
    return { success: false, error: { code: "PATH_NOT_FOUND", path: absoluteChangePath } };
  }

  const repoPath = findRepoRoot(absoluteChangePath);
  if (!repoPath) {
    return { success: false, error: { code: "NO_REPO_ROOT" } };
  }

  let repo = await repoRepository.getByPath(repoPath);
  if (!repo) {
    const now = new Date().toISOString();
    repo = await repoRepository.create({
      id: generateTypeId("repo"),
      path: repoPath,
      name: basename(repoPath),
      remote_origin: null,
      max_concurrent_tasks: 1,
      created_at: now,
      updated_at: now,
    });
  }

  const relativeChangePath = absoluteChangePath.replace(`${repoPath}/`, "");
  let task = await taskRepository.getByChangePath(repo.id, relativeChangePath);

  if (!task) {
    const now = new Date().toISOString();
    task = await taskRepository.create({
      id: generateTypeId("task"),
      repo_id: repo.id,
      change_path: relativeChangePath,
      worktree_path: null,
      status: "DRAFT",
      ready_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  return { success: true, task, repoPath, absoluteChangePath };
};

const createWorktree = async (log: Logger, gitManager: GitManager, taskId: string) => {
  log.info("Creating worktree...");
  const baseBranch = await gitManager.getDefaultBranch();
  const worktreeInfo = await gitManager.createWorktree(taskId, baseBranch);
  log.info("Worktree created at: {path}", { path: worktreeInfo.path });
  return worktreeInfo;
};

const runAgent = async (log: Logger, cwd: string, prompt: string) => {
  log.info("\nSpawning agent...\n");
  const provider = new ClaudeCodeProvider();
  return provider.run({ prompt, cwd, onOutput: agentOutputHandler });
};

interface PromptContext {
  changeName: string;
  proposal?: string;
  design?: string;
  tasks?: string;
  specs: Array<{ name: string; content: string }>;
}

const NAIVE_IMPLEMENT_TEMPLATE = `Implement the following change in this repository.

## Change: {{changeName}}

{{#if proposal}}
## Proposal

{{{proposal}}}
{{/if}}

{{#if design}}
## Design

{{{design}}}
{{/if}}

{{#if tasks}}
## Tasks

{{{tasks}}}
{{/if}}

{{#each specs}}
## Spec: {{this.name}}

{{{this.content}}}
{{/each}}
`;

const buildAgentPrompt = async (changePath: string, taskId: string): Promise<string> => {
  const context: PromptContext = {
    changeName: taskId,
    specs: await loadSpecs(changePath),
  };

  const proposalFile = Bun.file(join(changePath, "proposal.md"));
  if (await proposalFile.exists()) {
    context.proposal = await proposalFile.text();
  }

  const designFile = Bun.file(join(changePath, "design.md"));
  if (await designFile.exists()) {
    context.design = await designFile.text();
  }

  const tasksFile = Bun.file(join(changePath, "tasks.md"));
  if (await tasksFile.exists()) {
    context.tasks = await tasksFile.text();
  }

  const template = Handlebars.compile(NAIVE_IMPLEMENT_TEMPLATE);
  return template(context);
};

const loadSpecs = async (changePath: string): Promise<Array<{ name: string; content: string }>> => {
  const specsDir = join(changePath, "specs");

  if (!existsSync(specsDir)) {
    return [];
  }

  const glob = new Bun.Glob("*.md");
  const specs: Array<{ name: string; content: string }> = [];

  for await (const file of glob.scan({ cwd: specsDir })) {
    const content = await Bun.file(join(specsDir, file)).text();
    specs.push({
      name: file.replace(".md", ""),
      content,
    });
  }

  return specs;
};
