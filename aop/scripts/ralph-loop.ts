#!/usr/bin/env bun
/**
 * RALPH Loop - Run claude code in a loop with prettified streaming output
 *
 * Generic loop that runs a prompt repeatedly until a done keyword is found.
 *
 * Usage:
 *   bun scripts/ralph-loop.ts "/opsx:apply aop-platform-mvp"
 *   bun scripts/ralph-loop.ts --max 5 "/opsx:apply aop-platform-mvp"
 *   bun scripts/ralph-loop.ts --prompt-file ./my-prompt.md
 *   bun scripts/ralph-loop.ts --done-keyword "DONE" "/aop:execute-full"
 *   bun scripts/ralph-loop.ts --done-keyword "<aop>FINISHED</aop>" --max 50 "/aop:implement <task-id>"
 */

import { configureLogging, getLogger, type Logger } from "@aop/infra";
import {
  ClaudeCodeProvider,
  createOutputLogger,
  extractAssistantText,
  type RunResult,
} from "@aop/llm-provider";

const formatTimestamp = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
};

interface LogPaths {
  jsonl: string;
  pretty: string;
}

const getLogPaths = async (): Promise<LogPaths> => {
  await Bun.$`mkdir -p ./tmp`.quiet();
  const timestamp = formatTimestamp(new Date());
  return {
    jsonl: `./tmp/ralph-loop-${timestamp}.jsonl`,
    pretty: `./tmp/ralph-loop-${timestamp}.log`,
  };
};

interface ParsedArgs {
  maxLoops: number;
  prompt: string;
  doneKeyword: string;
  cwd?: string;
}

interface LoopRunResult extends RunResult {
  signals: string[];
}

const escapeRegex = (str: string): string => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: arg parsing needs many branches
const parseArgs = async (): Promise<ParsedArgs> => {
  const args = process.argv.slice(2);
  let maxLoops = Infinity;
  let prompt = "";
  let promptFile = "";
  let doneKeyword = "";
  let cwd: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === "--max" && nextArg) {
      maxLoops = Number.parseInt(nextArg, 10);
      i++;
    } else if (arg === "--prompt-file" && nextArg) {
      promptFile = nextArg;
      i++;
    } else if (arg === "--done-keyword" && nextArg) {
      doneKeyword = nextArg;
      i++;
    } else if (arg === "--cwd" && nextArg) {
      cwd = nextArg;
      i++;
    } else if (arg && !arg.startsWith("--")) {
      prompt = args.slice(i).join(" ");
      break;
    }
  }

  if (promptFile) {
    const file = Bun.file(promptFile);
    if (!(await file.exists())) {
      throw new Error(`prompt file not found: ${promptFile}`);
    }
    prompt = await file.text();
  }

  return { maxLoops, prompt, doneKeyword, cwd };
};

const USAGE = `
RALPH Loop - Run claude code in a loop

Usage:
  bun scripts/ralph-loop.ts <prompt>
  bun scripts/ralph-loop.ts --max 5 <prompt>
  bun scripts/ralph-loop.ts --prompt-file ./my-prompt.md

Options:
  --max <n>            Maximum number of loops (default: infinite)
  --prompt-file <f>    Read prompt from a markdown file
  --done-keyword <kw>  Exit loop when this keyword appears in output
  --cwd <path>         Working directory for claude (default: current)

Examples:
  bun scripts/ralph-loop.ts "/opsx:apply aop-platform-mvp"
  bun scripts/ralph-loop.ts --max 10 "implement the next task"
  bun scripts/ralph-loop.ts --prompt-file ./tasks/feature.md --max 5
  bun scripts/ralph-loop.ts --done-keyword "DONE" "/aop:execute-full"
`;

const printUsage = (log: Logger): void => {
  log.info(USAGE);
};

const extractSignals = (text: string, patterns: RegExp[]): string[] => {
  const signals: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) signals.push(match[0]);
  }
  return signals;
};

interface RunLoopOptions {
  prompt: string;
  signalPatterns: RegExp[];
  cwd?: string;
  iter: number;
}

const runLoop = async (
  provider: ClaudeCodeProvider,
  options: RunLoopOptions,
): Promise<LoopRunResult> => {
  const foundSignals: string[] = [];
  const baseHandler = createOutputLogger({ categories: ["ralph", "claude"], iter: options.iter });

  const onOutput = (data: Record<string, unknown>) => {
    baseHandler(data);
    // Also check for signals in assistant messages
    const text = extractAssistantText(data);
    if (text) {
      foundSignals.push(...extractSignals(text, options.signalPatterns));
    }
  };

  const result = await provider.run({
    prompt: options.prompt,
    cwd: options.cwd,
    onOutput,
  });

  return { ...result, signals: foundSignals };
};

const main = async () => {
  const logPaths = await getLogPaths();
  await configureLogging({
    level: "debug",
    sinks: {
      console: true,
      files: [
        { path: logPaths.jsonl, format: "json" },
        { path: logPaths.pretty, format: "pretty" },
      ],
    },
  });
  const loopLog = getLogger("ralph", "loop");

  loopLog.info("logging to {jsonl} and {pretty}", { ...logPaths });

  const { maxLoops, prompt, doneKeyword, cwd } = await parseArgs();

  if (!prompt) {
    printUsage(loopLog);
    process.exit(0);
  }

  const provider = new ClaudeCodeProvider();

  const signalPatterns = doneKeyword ? [new RegExp(escapeRegex(doneKeyword))] : [];

  let iter = 0;
  while (iter < maxLoops) {
    iter++;
    const loopDisplay =
      maxLoops === Number.POSITIVE_INFINITY ? String(iter) : `${iter}/${maxLoops}`;
    loopLog.info("loop {n}", { iter, n: loopDisplay });

    const result = await runLoop(provider, { prompt, signalPatterns, cwd, iter });

    if (result.exitCode !== 0) {
      loopLog.warn("claude exited with code {code}", { iter, code: result.exitCode });
    }

    loopLog.info("completed loop {n}", { iter, n: iter });

    if (result.signals.length > 0) {
      loopLog.info("found done keyword {keyword} - exiting loop", { iter, keyword: doneKeyword });
      break;
    }
  }

  loopLog.info("finished {n} loops", { n: iter });
};

main().catch(async (err) => {
  await configureLogging({ level: "error" });
  const log = getLogger("ralph");
  log.fatal("fatal error: {error}", { error: String(err) });
  process.exit(1);
});
