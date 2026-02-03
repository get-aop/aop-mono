import * as readline from "node:readline";
import {
  type ClaudeCodeQuestion,
  ClaudeCodeSession,
  type ClaudeCodeSessionResult,
  type ParsedStreamLine
} from "../core/claude-code-session";
import { loadGlobalConfig } from "../core/global-config";
import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";
import { ensureProjectRecord } from "../core/sqlite";
import { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import { parsePlan } from "../migration/plan-parser";
import { listSubtasks } from "../migration/subtask-parser";
import { listTaskFolders, parseTask } from "../migration/task-parser";
import type { ResolvedPaths } from "../types";

export interface CreateTaskArgs {
  description?: string;
  projectName?: string;
  slug?: string;
  debug?: boolean;
  raw?: boolean;
  api?: boolean;
  help?: boolean;
  error?: string;
}

export interface CreateTaskResult {
  success: boolean;
  message?: string;
  error?: string;
  taskId?: number;
  taskFolder?: string;
}

export const parseCreateTaskArgs = (args: string[]): CreateTaskArgs => {
  let description: string | undefined;
  let projectName: string | undefined;
  let slug: string | undefined;
  let debug = false;
  let raw = false;
  let api = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }

    if (arg === "-d" || arg === "--debug") {
      debug = true;
      continue;
    }

    if (arg === "-r" || arg === "--raw") {
      raw = true;
      continue;
    }

    if (arg === "-a" || arg === "--api") {
      api = true;
      continue;
    }

    if (arg === "-p" || arg === "--project") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { error: "--project requires a value" };
      }
      projectName = nextArg;
      i++;
      continue;
    }

    if (arg === "-s" || arg === "--slug") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { error: "--slug requires a value" };
      }
      slug = nextArg;
      i++;
      continue;
    }

    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }

    if (!description) {
      description = arg;
    }
  }

  return { description, projectName, slug, debug, raw, api };
};

const buildPrompt = (
  description?: string,
  slug?: string,
  paths?: ResolvedPaths
): string => {
  const parts: string[] = [];

  if (paths) {
    parts.push(`<aop-context>
mode: ${paths.mode}
project-name: ${paths.projectName}
project-root: ${paths.projectRoot}
tasks-dir: ${paths.devsfactoryDir}
</aop-context>`);
  }

  parts.push("/create-task");
  if (slug) parts.push(`--slug "${slug}"`);
  if (description) parts.push(`"${description}"`);

  return parts.join("\n");
};

const colors = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
  red: "\x1b[31m"
};

const formatToolUse = (
  name: string,
  input: Record<string, unknown>
): string => {
  const { dim, reset, cyan } = colors;

  switch (name) {
    case "Read":
      return `${cyan}📖 Reading${reset} ${dim}${input.file_path}${reset}`;
    case "Write":
      return `${cyan}✏️  Writing${reset} ${dim}${input.file_path}${reset}`;
    case "Edit":
      return `${cyan}📝 Editing${reset} ${dim}${input.file_path}${reset}`;
    case "Bash": {
      const cmd = String(input.command || "").slice(0, 60);
      return `${cyan}💻 Running${reset} ${dim}${cmd}${cmd.length >= 60 ? "..." : ""}${reset}`;
    }
    case "Glob":
      return `${cyan}🔍 Searching${reset} ${dim}${input.pattern}${reset}`;
    case "Grep":
      return `${cyan}🔎 Grep${reset} ${dim}${input.pattern}${reset}`;
    case "Task":
      return `${cyan}🤖 Agent${reset} ${dim}${input.description || ""}${reset}`;
    case "AskUserQuestion":
      return `${cyan}❓ Question${reset}`;
    default:
      return `${cyan}🔧 ${name}${reset}`;
  }
};

/**
 * Ask user a question in the terminal and return their answer.
 * Supports single-select and multi-select with numbered options.
 */
const askUserInTerminal = async (
  question: ClaudeCodeQuestion
): Promise<string> => {
  const { dim, reset, cyan } = colors;
  const separator = "─".repeat(50);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });

  const answers: Record<string, string | string[]> = {};

  try {
    for (const q of question.questions) {
      console.log(`\n${cyan}${separator}${reset}`);
      if (q.header) {
        console.log(`${dim}[${q.header}]${reset}`);
      }
      console.log(q.question);
      console.log(`${cyan}${separator}${reset}`);

      if (q.options && q.options.length > 0) {
        const allChoices = [
          ...q.options,
          { label: "Other", description: "Enter custom response" }
        ];

        allChoices.forEach((choice, index) => {
          console.log(
            `  ${index + 1}) ${choice.label} - ${choice.description}`
          );
        });
        console.log();

        if (q.multiSelect) {
          console.log(
            `${dim}(Enter comma-separated numbers, e.g., 1,3)${reset}`
          );
          let validSelection = false;
          while (!validSelection) {
            const answer = await askQuestion(
              `${dim}Select (1-${allChoices.length}): ${reset}`
            );
            const parts = answer.split(",").map((p) => p.trim());
            const selections: number[] = [];
            let valid = true;

            for (const part of parts) {
              const num = parseInt(part, 10);
              if (Number.isNaN(num) || num < 1 || num > allChoices.length) {
                console.log(
                  `Invalid selection: ${part}. Please enter numbers between 1 and ${allChoices.length}`
                );
                valid = false;
                break;
              }
              selections.push(num);
            }

            if (valid) {
              const selectedLabels: string[] = [];
              for (const sel of selections) {
                if (sel === allChoices.length) {
                  const customAnswer = await askQuestion(
                    `${dim}Enter your response: ${reset}`
                  );
                  selectedLabels.push(customAnswer);
                } else {
                  selectedLabels.push(allChoices[sel - 1]!.label);
                }
              }
              answers[q.header || q.question] = selectedLabels;
              validSelection = true;
            }
          }
        } else {
          let validSelection = false;
          while (!validSelection) {
            const answer = await askQuestion(
              `${dim}Select (1-${allChoices.length}): ${reset}`
            );
            const selection = parseInt(answer, 10);

            if (
              Number.isNaN(selection) ||
              selection < 1 ||
              selection > allChoices.length
            ) {
              console.log(
                `Please enter a number between 1 and ${allChoices.length}`
              );
              continue;
            }

            if (selection === allChoices.length) {
              const customAnswer = await askQuestion(
                `${dim}Enter your response: ${reset}`
              );
              answers[q.header || q.question] = customAnswer;
            } else {
              answers[q.header || q.question] =
                allChoices[selection - 1]!.label;
            }
            validSelection = true;
          }
        }
      } else {
        const answer = await askQuestion(`${dim}> ${reset}`);
        answers[q.header || q.question] = answer;
      }
    }

    return JSON.stringify({ answers });
  } finally {
    rl.close();
  }
};

/**
 * Run interactive session using Claude Code subprocess.
 * Uses the kill/resume pattern for user interaction.
 */
const runClaudeCodeSessionMode = async (
  cwd: string,
  prompt: string,
  debug: boolean
): Promise<CreateTaskResult> => {
  const { dim, reset, green, red, cyan, yellow } = colors;

  // Load model from global config
  const globalConfig = await loadGlobalConfig();
  const configuredModel = globalConfig.providers?.["claude-code"]?.model;

  console.log(`${dim}Starting Claude Code session${reset}`);
  console.log(`${dim}Working directory: ${cwd}${reset}\n`);

  const session = new ClaudeCodeSession();

  // Handle output events for UI display
  session.on("output", ({ parsed }: { parsed: ParsedStreamLine | null }) => {
    if (!parsed) return;

    // Handle system init
    if (parsed.type === "system" && parsed.subtype === "init") {
      console.log(`${green}● Session started${reset}\n`);
      return;
    }

    // Handle assistant messages
    if (parsed.type === "assistant") {
      for (const item of parsed.content) {
        if (item.type === "text" && item.text) {
          process.stdout.write(item.text);
        } else if (item.type === "tool_use" && item.name) {
          if (item.name !== "AskUserQuestion") {
            console.log(
              `\n${formatToolUse(item.name, (item.input ?? {}) as Record<string, unknown>)}`
            );
          }
        }
      }
    }
  });

  try {
    let result: ClaudeCodeSessionResult = await session.run({
      cwd,
      prompt,
      model: configuredModel
    });

    if (debug) {
      console.log(
        `\n${dim}[DEBUG] Initial: status=${result.status}, sessionId=${result.sessionId}, hasQuestion=${!!result.question}${reset}`
      );
    }

    // Always log status for debugging this issue
    console.log(
      `${dim}[Session] status=${result.status}, hasQuestion=${!!result.question}${reset}`
    );

    // Handle the kill/resume loop for user questions
    // Enforce one question at a time
    const MAX_ONE_QUESTION_RETRIES = 5;
    const MAX_QUESTIONS = 5; // Maximum questions to ask user during brainstorming
    let oneQuestionRetries = 0;
    let questionCount = 0;

    while (result.status === "waiting_for_input" && result.question) {
      // Enforce one question at a time
      if (result.question.questions.length > 1) {
        oneQuestionRetries++;
        if (oneQuestionRetries > MAX_ONE_QUESTION_RETRIES) {
          console.log(
            `\n${red}✗ Error${reset}: Claude keeps sending multiple questions despite being asked to send one at a time`
          );
          return {
            success: false,
            error:
              "Failed to enforce one question at a time after multiple retries"
          };
        }

        console.log(
          `${yellow}⚠ Claude sent ${result.question.questions.length} questions at once, asking to send one at a time...${reset}`
        );

        // Resume with error message - Claude will retry with one question
        result = await session.run({
          cwd,
          resume: result.sessionId,
          prompt: `Error: You MUST ask exactly ONE question at a time. You sent ${result.question.questions.length} questions. Call AskUserQuestion again with ONLY ONE question.`,
          model: configuredModel
        });
        continue;
      }

      oneQuestionRetries = 0;
      questionCount++;

      // Enforce max questions limit
      if (questionCount > MAX_QUESTIONS) {
        console.log(
          `\n${yellow}⚠ Reached maximum of ${MAX_QUESTIONS} questions. Asking Claude to proceed with design.${reset}`
        );

        result = await session.run({
          cwd,
          resume: result.sessionId,
          prompt: `You have asked ${MAX_QUESTIONS} questions already. Please proceed with the design based on the information gathered so far. Make reasonable assumptions for any missing details and document them.`,
          model: configuredModel
        });
        continue;
      }

      // Ask user and get answer
      console.log(
        `\n${cyan}❓ Claude needs your input (${questionCount}/${MAX_QUESTIONS})${reset}`
      );
      const answer = await askUserInTerminal(result.question);

      if (debug) {
        console.log(
          `${dim}[DEBUG] Resuming with answer: ${answer.slice(0, 100)}...${reset}`
        );
      }

      // Resume with just the answer as the prompt
      result = await session.run({
        cwd,
        resume: result.sessionId,
        prompt: answer,
        model: configuredModel
      });

      // Always log status for debugging
      console.log(
        `${dim}[Session] After resume: status=${result.status}, hasQuestion=${!!result.question}${reset}`
      );
    }

    // Display final status
    if (result.status === "completed") {
      const usage = result.usage;
      if (usage) {
        console.log(
          `\n\n${green}✓ Done${reset} ${dim}(${usage.inputTokens} in, ${usage.outputTokens} out, $${usage.totalCostUsd.toFixed(4)})${reset}`
        );
      } else {
        console.log(`\n\n${green}✓ Done${reset}`);
      }
      return { success: true };
    } else if (result.status === "error") {
      console.log(
        `\n\n${red}✗ Error${reset}: ${result.error ?? "Unknown error"}`
      );
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (err) {
    console.log(
      `\n\n${red}✗ Error${reset}: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
};

/**
 * Raw mode: Claude handles questions directly via inherited stdin.
 */
const runRawSession = async (
  cwd: string,
  prompt: string
): Promise<CreateTaskResult> => {
  const { dim, reset, green, yellow } = colors;

  console.log(`${dim}Starting interactive Claude session in ${cwd}${reset}`);
  console.log(
    `${dim}Claude will handle questions directly via terminal${reset}\n`
  );

  const args = [
    "claude",
    "--output-format",
    "stream-json",
    "--verbose",
    "-p",
    prompt
  ];

  const proc = Bun.spawn(args, {
    cwd,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe"
  });

  const decoder = new TextDecoder();

  const processLine = (line: string): void => {
    try {
      const event = JSON.parse(line);

      if (event.type === "system" && event.subtype === "init") {
        console.log(
          `${green}● Session started${reset} ${dim}(${event.model})${reset}\n`
        );
        return;
      }

      if (event.type === "assistant" && event.message?.content) {
        for (const item of event.message.content) {
          if (item.type === "text" && item.text) {
            process.stdout.write(item.text);
          } else if (item.type === "tool_use") {
            if (item.name !== "AskUserQuestion") {
              console.log(`\n${formatToolUse(item.name, item.input || {})}`);
            }
          }
        }
        return;
      }

      if (event.type === "result") {
        const status =
          event.subtype === "success"
            ? `${green}✓ Done${reset}`
            : `${yellow}⚠ ${event.subtype}${reset}`;
        const cost = event.total_cost_usd
          ? `${dim}($${event.total_cost_usd.toFixed(4)})${reset}`
          : "";
        console.log(`\n\n${status} ${cost}`);
        return;
      }
    } catch {
      // Not JSON, ignore
    }
  };

  const readStdout = async () => {
    let buffer = "";
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        processLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) processLine(buffer);
  };

  const readStderr = async () => {
    for await (const _chunk of proc.stderr as ReadableStream<Uint8Array>) {
      // Silently ignore stderr
    }
  };

  await Promise.all([readStdout(), readStderr(), proc.exited]);

  return {
    success: proc.exitCode === 0,
    message:
      proc.exitCode === 0
        ? undefined
        : `Claude exited with code ${proc.exitCode}`
  };
};

export const syncNewTaskToSQLite = async (input: {
  projectName: string;
  devsfactoryDir: string;
  taskFolder: string;
}): Promise<void> => {
  const storage = new SQLiteTaskStorage({ projectName: input.projectName });

  const existing = await storage.getTask(input.taskFolder);
  if (existing) return;

  const task = await parseTask(input.taskFolder, input.devsfactoryDir);

  await storage.createTaskWithContent({
    folder: task.folder,
    frontmatter: task.frontmatter,
    description: task.description,
    requirements: task.requirements,
    acceptanceCriteria: task.acceptanceCriteria.map((c) => c.text),
    notes: task.notes
  });

  const plan = await parsePlan(input.taskFolder, input.devsfactoryDir);
  if (plan) {
    await storage.createPlan(input.taskFolder, {
      frontmatter: plan.frontmatter,
      subtasks: plan.subtasks
    });
  }

  const subtasks = await listSubtasks(input.taskFolder, input.devsfactoryDir);
  for (const subtask of subtasks) {
    await storage.createSubtaskWithContent(input.taskFolder, {
      filename: subtask.filename,
      frontmatter: {
        title: subtask.frontmatter.title,
        status: subtask.frontmatter.status,
        dependencies: subtask.frontmatter.dependencies
      },
      objective: subtask.description,
      acceptanceCriteria: undefined,
      tasksChecklist: undefined,
      result: subtask.result
    });
  }
};

const findNewTaskFolder = async (
  devsfactoryDir: string,
  knownFolders: string[]
): Promise<string | null> => {
  const currentFolders = await listTaskFolders(devsfactoryDir);
  const knownSet = new Set(knownFolders);
  const newFolders = currentFolders.filter((f) => !knownSet.has(f));
  return newFolders.length > 0 ? newFolders[0]! : null;
};

export const runCreateTaskCommand = async (
  args: CreateTaskArgs
): Promise<CreateTaskResult> => {
  const { description, projectName, slug, debug, raw } = args;

  const paths = projectName
    ? await resolvePathsForProject(projectName)
    : await resolvePaths();

  if (!paths) {
    const errorMsg = projectName
      ? `Project '${projectName}' not found. Run 'aop projects' to see registered projects.`
      : "Not in a project context. Either:\n" +
        "  - Run from a registered project directory\n" +
        "  - Specify a project: aop create-task <description> -p <project>";
    return { success: false, error: errorMsg };
  }

  const prompt = buildPrompt(description, slug, paths);
  const storage = new SQLiteTaskStorage({ projectName: paths.projectName });
  const beforeFolders = await storage.listTaskFolders();

  if (raw) {
    const result = await runRawSession(paths.projectRoot, prompt);
    if (result.success) {
      ensureProjectRecord({
        name: paths.projectName,
        path: paths.projectRoot
      });
      const newTaskFolder = await findNewTaskFolder(
        paths.devsfactoryDir,
        beforeFolders
      );
      if (newTaskFolder) {
        await syncNewTaskToSQLite({
          projectName: paths.projectName,
          devsfactoryDir: paths.devsfactoryDir,
          taskFolder: newTaskFolder
        });
        const taskId = await storage.getTaskId(newTaskFolder);
        return {
          ...result,
          message: `Task created: id ${taskId} (folder ${newTaskFolder}).`,
          taskId: taskId ?? undefined,
          taskFolder: newTaskFolder
        };
      }
    }
    return result;
  }

  // Default to Claude Code session (kill/resume pattern)
  const result = await runClaudeCodeSessionMode(
    paths.projectRoot,
    prompt,
    debug ?? false
  );
  if (result.success) {
    ensureProjectRecord({
      name: paths.projectName,
      path: paths.projectRoot
    });
    const newTaskFolder = await findNewTaskFolder(
      paths.devsfactoryDir,
      beforeFolders
    );
    if (newTaskFolder) {
      await syncNewTaskToSQLite({
        projectName: paths.projectName,
        devsfactoryDir: paths.devsfactoryDir,
        taskFolder: newTaskFolder
      });
      const taskId = await storage.getTaskId(newTaskFolder);
      return {
        ...result,
        message: `Task created: id ${taskId} (folder ${newTaskFolder}).`,
        taskId: taskId ?? undefined,
        taskFolder: newTaskFolder
      };
    }
  }
  return result;
};
