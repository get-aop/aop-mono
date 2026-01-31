import { runClaudeSession } from "../core/claude-session";
import { createCliIOHandler } from "../core/cli-io-handler";
import { resolvePaths, resolvePathsForProject } from "../core/path-resolver";

export interface SysDebugArgs {
  description?: string;
  projectName?: string;
  debug?: boolean;
  raw?: boolean;
  help?: boolean;
  error?: string;
}

export interface SysDebugResult {
  success: boolean;
  message?: string;
  error?: string;
}

export const parseSysDebugArgs = (args: string[]): SysDebugArgs => {
  let description: string | undefined;
  let projectName: string | undefined;
  let debug = false;
  let raw = false;

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

    if (arg === "-p" || arg === "--project") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { error: "--project requires a value" };
      }
      projectName = nextArg;
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

  return { description, projectName, debug, raw };
};

const buildPrompt = (description: string): string => {
  return `/systematic-debugging ${description}`;
};

const runRawDebugSession = async (
  cwd: string,
  prompt: string
): Promise<SysDebugResult> => {
  console.log("=== RAW DEBUG MODE ===");
  console.log(`CWD: ${cwd}`);
  console.log(`Prompt: ${prompt}`);
  console.log("");

  const args = [
    "claude",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    prompt
  ];

  console.log(`Command: ${args.join(" ")}`);
  console.log("=".repeat(50));
  console.log("");

  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });

  console.log(`Process spawned with PID: ${proc.pid}`);
  console.log("");

  const decoder = new TextDecoder();

  const readStdout = async () => {
    console.log("--- STDOUT START ---");
    let lineNum = 0;
    let buffer = "";

    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        lineNum++;
        console.log(`[STDOUT ${lineNum}] ${line}`);
        newlineIndex = buffer.indexOf("\n");
      }
    }

    if (buffer.trim()) {
      lineNum++;
      console.log(`[STDOUT ${lineNum}] ${buffer}`);
    }
    console.log("--- STDOUT END ---");
  };

  const readStderr = async () => {
    console.log("--- STDERR START ---");
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      const text = decoder.decode(chunk, { stream: true });
      process.stderr.write(`[STDERR] ${text}`);
    }
    console.log("\n--- STDERR END ---");
  };

  await Promise.all([readStdout(), readStderr(), proc.exited]);

  console.log("");
  console.log("=".repeat(50));
  console.log(`Exit code: ${proc.exitCode}`);

  return {
    success: proc.exitCode === 0,
    message: `Raw debug completed with exit code ${proc.exitCode}`
  };
};

export const runSysDebugCommand = async (
  args: SysDebugArgs
): Promise<SysDebugResult> => {
  const { description, projectName, debug, raw } = args;

  if (!description) {
    return {
      success: false,
      error:
        "Missing bug/issue description.\n\n" +
        "Usage: aop sys-debug <description> [options]\n\n" +
        "Options:\n" +
        "  -r, --raw     Show raw Claude output for debugging\n" +
        "  -d, --debug   Enable debug logging\n" +
        "  -p, --project Specify project name\n\n" +
        "Example:\n" +
        '  aop sys-debug "Tests are failing" --raw'
    };
  }

  const paths = projectName
    ? await resolvePathsForProject(projectName)
    : await resolvePaths();

  if (!paths) {
    const errorMsg = projectName
      ? `Project '${projectName}' not found. Run 'aop projects' to see registered projects.`
      : "Not in a project context. Either:\n" +
        "  - Run from a registered project directory\n" +
        "  - Specify a project: aop sys-debug <description> -p <project>";
    return { success: false, error: errorMsg };
  }

  const prompt = buildPrompt(description);

  if (raw) {
    return runRawDebugSession(paths.projectRoot, prompt);
  }

  console.log(`Starting Claude Code in ${paths.projectRoot}...`);
  console.log(`Prompt: ${prompt}\n`);

  const result = await runClaudeSession({
    cwd: paths.projectRoot,
    prompt,
    ioHandler: createCliIOHandler(),
    debug
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? `Claude exited with code ${result.exitCode}`
    };
  }

  return {
    success: true,
    message: "Claude Code session completed."
  };
};
