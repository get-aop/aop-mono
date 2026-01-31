import type { FileSink, Subprocess } from "bun";
import type { ClaudeEventHandler } from "./claude-events";
import {
  isAskUserQuestionInput,
  isAssistantEvent,
  isInitEvent,
  isResultEvent,
  isTextContent,
  isToolUseContent,
  parseClaudeEvent
} from "./claude-events";

export interface IOHandler {
  onOutput: (data: Uint8Array) => void;
  onError: (data: Uint8Array) => void;
  getInput: () => ReadableStream<Uint8Array> | null;
}

export interface ClaudeSessionOptions {
  cwd: string;
  prompt: string;
  ioHandler?: IOHandler;
  interactive?: boolean;
  debug?: boolean;
}

export interface JsonStreamSessionOptions {
  cwd: string;
  prompt: string;
  eventHandler: ClaudeEventHandler;
  debug?: boolean;
}

export interface ClaudeSessionResult {
  success: boolean;
  exitCode: number;
  error?: string;
  totalCostUsd?: number;
}

type PipedSubprocess = Subprocess<"pipe", "pipe", "pipe">;
type InheritSubprocess = Subprocess<"inherit", "inherit", "inherit">;

export const runClaudeSession = async (
  options: ClaudeSessionOptions
): Promise<ClaudeSessionResult> => {
  const {
    cwd,
    prompt,
    ioHandler,
    interactive = false,
    debug = false
  } = options;

  if (interactive) {
    return runInteractiveSession(cwd, prompt, debug);
  }

  return runPipedSession(cwd, prompt, ioHandler!, debug);
};

const buildClaudeArgs = (
  prompt: string,
  debug: boolean,
  printMode: boolean
): string[] => {
  const args = ["claude"];
  if (debug) args.push("-d");
  if (printMode) args.push("-p");
  args.push(prompt);
  return args;
};

const runInteractiveSession = async (
  cwd: string,
  prompt: string,
  debug: boolean
): Promise<ClaudeSessionResult> => {
  let proc: InheritSubprocess;

  try {
    proc = Bun.spawn(buildClaudeArgs(prompt, debug, false), {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    });
  } catch (error) {
    return {
      success: false,
      exitCode: -1,
      error: `Failed to spawn Claude: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  await proc.exited;
  const exitCode = proc.exitCode ?? 0;

  return {
    success: exitCode === 0,
    exitCode
  };
};

const runPipedSession = async (
  cwd: string,
  prompt: string,
  ioHandler: IOHandler,
  debug: boolean
): Promise<ClaudeSessionResult> => {
  let proc: PipedSubprocess;

  const args = buildClaudeArgs(prompt, debug, true); // Use -p for print mode with pipes
  console.error(`[DEBUG] Spawning: ${args.join(" ")}`);
  console.error(`[DEBUG] CWD: ${cwd}`);

  try {
    proc = Bun.spawn(args, {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    console.error(`[DEBUG] Process spawned, PID: ${proc.pid}`);
  } catch (error) {
    return {
      success: false,
      exitCode: -1,
      error: `Failed to spawn Claude: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const readStream = async (
    stream: ReadableStream<Uint8Array>,
    handler: (data: Uint8Array) => void,
    label: string
  ) => {
    console.error(`[DEBUG] Starting to read ${label}`);
    for await (const chunk of stream) {
      console.error(`[DEBUG] ${label} received ${chunk.length} bytes`);
      handler(chunk);
    }
    console.error(`[DEBUG] ${label} stream ended`);
  };

  const stdin = proc.stdin as FileSink;
  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const stderr = proc.stderr as ReadableStream<Uint8Array>;

  const stdoutPromise = readStream(stdout, ioHandler.onOutput, "stdout");
  const stderrPromise = readStream(stderr, ioHandler.onError, "stderr");

  // Close stdin immediately - Claude with piped I/O needs -p mode for output
  console.error(`[DEBUG] Closing stdin immediately to trigger Claude output`);
  stdin.end();

  console.error(`[DEBUG] Waiting for process to complete...`);
  await Promise.all([stdoutPromise, stderrPromise, proc.exited]);

  const exitCode = proc.exitCode ?? 0;
  console.error(`[DEBUG] Process exited with code: ${exitCode}`);

  return {
    success: exitCode === 0,
    exitCode
  };
};

const buildJsonStreamArgs = (prompt: string, debug: boolean): string[] => {
  const args = ["claude"];
  args.push("--output-format", "stream-json");
  args.push("--verbose");
  args.push("--dangerously-skip-permissions");
  if (debug) args.push("-d");
  args.push(prompt);
  return args;
};

export const runJsonStreamSession = async (
  options: JsonStreamSessionOptions
): Promise<ClaudeSessionResult> => {
  const { cwd, prompt, eventHandler, debug = false } = options;

  let proc: PipedSubprocess;
  const args = buildJsonStreamArgs(prompt, debug);

  if (debug) {
    console.error(`[DEBUG] Spawning JSON stream: ${args.join(" ")}`);
    console.error(`[DEBUG] CWD: ${cwd}`);
  }

  try {
    proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe"
    });
    if (debug) {
      console.error(`[DEBUG] Process spawned, PID: ${proc.pid}`);
    }
  } catch (error) {
    const err = new Error(
      `Failed to spawn Claude: ${error instanceof Error ? error.message : String(error)}`
    );
    eventHandler.onError(err);
    return {
      success: false,
      exitCode: -1,
      error: err.message
    };
  }

  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const stderr = proc.stderr as ReadableStream<Uint8Array>;

  let totalCostUsd: number | undefined;

  const processStderr = async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stderr) {
      if (debug) {
        console.error(`[STDERR] ${decoder.decode(chunk)}`);
      }
    }
  };

  const processStdout = async () => {
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of stdout) {
      buffer += decoder.decode(chunk, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line) {
          const event = parseClaudeEvent(line);
          if (event) {
            await handleEvent(event, eventHandler, debug);
            if (isResultEvent(event)) {
              totalCostUsd = event.total_cost_usd;
            }
          } else if (debug) {
            console.error(`[DEBUG] Unparseable line: ${line}`);
          }
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    if (buffer.trim()) {
      const event = parseClaudeEvent(buffer.trim());
      if (event) {
        await handleEvent(event, eventHandler, debug);
        if (isResultEvent(event)) {
          totalCostUsd = event.total_cost_usd;
        }
      }
    }
  };

  const stderrPromise = processStderr();
  const stdoutPromise = processStdout();

  await Promise.all([stdoutPromise, stderrPromise, proc.exited]);

  const exitCode = proc.exitCode ?? 0;
  if (debug) {
    console.error(`[DEBUG] Process exited with code: ${exitCode}`);
  }

  return {
    success: exitCode === 0,
    exitCode,
    totalCostUsd
  };
};

const handleEvent = async (
  event: ReturnType<typeof parseClaudeEvent>,
  handler: ClaudeEventHandler,
  _debug: boolean
): Promise<void> => {
  if (!event) return;

  if (isInitEvent(event)) {
    handler.onInit(event);
    return;
  }

  if (isAssistantEvent(event)) {
    for (const content of event.message.content) {
      if (isTextContent(content)) {
        handler.onText(content.text);
      } else if (isToolUseContent(content)) {
        if (
          content.name === "AskUserQuestion" &&
          isAskUserQuestionInput(content.input)
        ) {
          // For now, just notify the handler - bidirectional stdin support can be added later
          await handler.onAskQuestion(content.id, content.input);
        } else {
          handler.onToolUse(content.id, content.name, content.input);
        }
      }
    }
    return;
  }

  if (isResultEvent(event)) {
    handler.onResult(event);
  }
};
