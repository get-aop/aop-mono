import { loadGlobalConfig } from "../core/global-config";
import {
  createTerminalIOHandler,
  type IOHandler
} from "../core/interactive-io-handler";
import { InteractiveSession } from "../core/interactive-session";
import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";
import type { ResolvedPaths } from "../types";
import { ensureAuth } from "./auth";

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
brainstorm-dir: ${paths.brainstormDir}
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
 * Run interactive session using direct Anthropic API.
 * Questions are handled directly in the terminal via IOHandler.
 * Uses pi-coding-agent's skill system to load skills from ~/.claude/skills/
 */
const runApiSession = async (
  cwd: string,
  prompt: string,
  debug: boolean
): Promise<CreateTaskResult> => {
  const { dim, reset, green, red } = colors;

  // Ensure authentication is set up
  const apiKey = await ensureAuth();
  if (!apiKey) {
    return {
      success: false,
      error:
        "Not authenticated. Run 'aop auth' to set up Anthropic API authentication."
    };
  }

  // Load model from global config
  const globalConfig = await loadGlobalConfig();
  const configuredModel = globalConfig.providers?.["claude-code"]?.model;

  console.log(`${dim}Starting interactive session (Direct API)${reset}`);
  console.log(`${dim}Working directory: ${cwd}${reset}\n`);

  const ioHandler: IOHandler = createTerminalIOHandler({
    silent: false,
    showToolUse: true
  });

  try {
    // No custom systemPrompt - let pi-coding-agent build it with discovered skills
    const session = new InteractiveSession({
      cwd,
      ioHandler,
      model: configuredModel,
      debug
    });

    session.on("started", ({ model }) => {
      console.log(
        `${green}● Session started${reset} ${dim}(${model})${reset}\n`
      );
    });

    session.on("complete", ({ inputTokens, outputTokens, totalCostUsd }) => {
      console.log(
        `\n\n${green}✓ Done${reset} ${dim}(${inputTokens} in, ${outputTokens} out, $${totalCostUsd.toFixed(4)})${reset}`
      );
    });

    session.on("error", ({ error }) => {
      console.log(`\n\n${red}✗ Error${reset}: ${error}`);
    });

    const result = await session.run(prompt);

    return {
      success: result.success,
      message: result.success ? undefined : (result.error ?? "Session failed"),
      error: result.error
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    ioHandler.close();
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

  if (raw) {
    return runRawSession(paths.projectRoot, prompt);
  }

  // Default to API session (direct Anthropic API)
  return runApiSession(paths.projectRoot, prompt, debug ?? false);
};
