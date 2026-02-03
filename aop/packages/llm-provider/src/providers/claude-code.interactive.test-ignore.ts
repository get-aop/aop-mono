/**
 * POC: Interactive Claude Code sessions with kill/resume pattern
 *
 * Demonstrates how to:
 * 1. Spawn Claude Code and detect when it asks a question (AskUserQuestion tool)
 * 2. Kill the process to pause execution
 * 3. Resume the session with --resume <sessionId> and provide the answer as the prompt
 *
 * Key findings:
 * - Use stdin: "inherit" (not "pipe") - Claude Code requires TTY or inherited stdin
 *   See: https://github.com/anthropics/claude-code/issues/9026
 *   Claude uses Ink library which has TTY detection - piped stdin causes hangs
 * - The --resume pattern works: claude --resume <sessionId> <answer>
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { configureLogging, getLogger } from "@aop/infra";

const isCI = Boolean(process.env.CI);
const log = getLogger("aop", "llm-provider", "interactive-test");

beforeAll(async () => {
  await configureLogging({ level: "info" });
});

interface StreamEvent {
  type: string;
  session_id?: string;
  message?: {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>;
  };
}

interface SpawnResult {
  sessionId?: string;
  proc: ReturnType<typeof Bun.spawn>;
  events: StreamEvent[];
}

const parseStreamLine = (line: string): StreamEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
};

const processEvent = (
  event: StreamEvent,
  state: { sessionId?: string; events: StreamEvent[] },
): void => {
  state.events.push(event);
  if (event.session_id) {
    state.sessionId = event.session_id;
  }
};

const processLines = (
  lines: string[],
  state: { sessionId?: string; events: StreamEvent[] },
  onEvent: (event: StreamEvent) => "stop" | "continue",
): boolean => {
  for (const line of lines) {
    const event = parseStreamLine(line);
    if (!event) continue;

    processEvent(event, state);
    if (onEvent(event) === "stop") return true;
  }
  return false;
};

/**
 * Spawns Claude Code and processes its output stream.
 * Returns when a condition is met or the process exits.
 */
const spawnClaudeCode = async (options: {
  prompt: string;
  cwd?: string;
  sessionId?: string;
  onEvent: (event: StreamEvent) => "stop" | "continue";
}): Promise<SpawnResult> => {
  const args = ["--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }
  args.push(options.prompt);

  log.info("Spawning claude with args: {args}", { args: args.join(" ") });

  const proc = Bun.spawn(["claude", ...args], {
    stdout: "pipe",
    stderr: "inherit",
    stdin: "inherit",
    cwd: options.cwd,
  });

  const state = { sessionId: undefined as string | undefined, events: [] as StreamEvent[] };
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    if (processLines(lines, state, options.onEvent)) break;
  }

  // Process remaining buffer
  if (buffer.trim()) {
    const event = parseStreamLine(buffer);
    if (event) processEvent(event, state);
  }

  return { sessionId: state.sessionId, proc, events: state.events };
};

/**
 * Detects if an event contains an AskUserQuestion tool use
 */
const isAskUserQuestion = (
  event: StreamEvent,
): { toolUseId: string; questions: unknown } | null => {
  if (event.type !== "assistant") return null;

  const content = event.message?.content;
  if (!Array.isArray(content)) return null;

  const block = content.find((c) => c.type === "tool_use" && c.name === "AskUserQuestion");
  if (!block) return null;

  return { toolUseId: block.id ?? "", questions: block.input };
};

/**
 * Extracts text content from assistant messages
 */
const extractAssistantText = (events: StreamEvent[]): string => {
  return events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => e.message?.content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("");
};

describe.skipIf(isCI)("ClaudeCodeProvider interactive session", () => {
  test("kill on question, resume with answer", async () => {
    let questionInfo: { toolUseId: string; questions: unknown } | null = null;

    const prompt1 = `I want to create a new file. Before you do anything, you MUST use the AskUserQuestion tool to ask me which programming language I want to use. The options should be: "TypeScript", "Python", "Go". Do not create any file until I answer.`;

    log.info("Phase 1: Starting session, waiting for question...");

    const result1 = await spawnClaudeCode({
      prompt: prompt1,
      onEvent: (event) => {
        const askInfo = isAskUserQuestion(event);
        if (askInfo) {
          questionInfo = askInfo;
          log.info("Detected AskUserQuestion: {questions}", {
            questions: JSON.stringify(askInfo.questions),
          });
          return "stop";
        }
        return "continue";
      },
    });

    expect(result1.sessionId).toBeDefined();
    expect(questionInfo).not.toBeNull();
    log.info("Session ID: {sessionId}", { sessionId: result1.sessionId });
    log.info("Question detected, killing process...", {
      questionInfo: JSON.stringify(questionInfo),
    });

    result1.proc.kill();
    await result1.proc.exited;

    // Phase 2: Resume the session with the answer
    log.info("Phase 2: Resuming session with answer...");

    const result2 = await spawnClaudeCode({
      prompt: "TypeScript",
      sessionId: result1.sessionId,
      onEvent: () => "continue",
    });

    const exitCode = await result2.proc.exited;
    log.info("Session completed with exit code: {exitCode}", { exitCode });

    const finalText = extractAssistantText(result2.events);
    log.info("Final response: {text}", { text: finalText.slice(0, 500) });

    expect(exitCode).toBe(0);
    expect(finalText.toLowerCase()).toMatch(/typescript|file|creat/i);
  }, 120_000);
});

/**
 * Logs Evidence
 * 
 * bun test claude-code.interactive.test.ts          13s  05:48:41 PM
bun test v1.3.6 (d530ed99)

packages/llm-provider/src/providers/claude-code.interactive.test.ts:
22:49:37.359  ✨ info    aop…interactive-test Phase 1: Starting session, waiting for question...
22:49:37.361  ✨ info    aop…interactive-test Spawning claude with args: '--output-format stream-json --verbose
                                              --dangerously-skip-permissions I want to create a new file. Before you do
                                              anything, you MUST use the AskUserQuestion tool to ask me which
                                              programming language I want to use. The options should be: "TypeScript",
                                              "Python", "Go". Do not create any file until I answer.'
                                        args: '--output-format stream-json --verbose --dangerously-skip-permissions I
                                              want to create a new file. Before you do anything, you MUST use the
                                              AskUserQuestion tool to ask me which programming language I want to use.
                                              The options should be: "TypeScript", "Python", "Go". Do not create any
                                              file until I answer.'
22:49:43.697  ✨ info    aop…interactive-test Detected AskUserQuestion: '{"questions":[{"question":"Which programming
                                              language would you like to use for the new
                                              file?","header":"Language","options":[{"label":"TypeScript","description":"Modern
                                              JavaScript with static
                                              typing"},{"label":"Python","description":"Versatile scripting and
                                              general-purpose language"},{"label":"Go","description":"Compiled language
                                              with strong concurrency support"}],"multiSelect":false}]}'
                                   questions: '{"questions":[{"question":"Which programming language would you like to
                                              use for the new
                                              file?","header":"Language","options":[{"label":"TypeScript","description":"Modern
                                              JavaScript with static
                                              typing"},{"label":"Python","description":"Versatile scripting and
                                              general-purpose language"},{"label":"Go","description":"Compiled language
                                              with strong concurrency support"}],"multiSelect":false}]}'
22:49:43.701  ✨ info    aop…interactive-test Session ID: '51c1cb4e-0d29-4d75-ab3d-b945c405a0ee'
                                   sessionId: '51c1cb4e-0d29-4d75-ab3d-b945c405a0ee'
22:49:43.702  ✨ info    aop…interactive-test Question detected, killing process...
                                questionInfo:
                                              '{"toolUseId":"toolu_01113r8q6VFW4LtdLo4aBz7M","questions":{"questions":[{"question":"Which
                                              programming language would you like to use for the new
                                              file?","header":"Language","options":[{"label":"TypeScript","description":"Modern
                                              JavaScript with static
                                              typing"},{"label":"Python","description":"Versatile scripting and
                                              general-purpose language"},{"label":"Go","description":"Compiled language
                                              with strong concurrency support"}],"multiSelect":false}]}}'
22:49:43.722  ✨ info    aop…interactive-test Phase 2: Resuming session with answer...
22:49:43.723  ✨ info    aop…interactive-test Spawning claude with args: '--output-format stream-json --verbose
                                              --dangerously-skip-permissions --resume
                                              51c1cb4e-0d29-4d75-ab3d-b945c405a0ee TypeScript'
                                        args: '--output-format stream-json --verbose --dangerously-skip-permissions
                                              --resume 51c1cb4e-0d29-4d75-ab3d-b945c405a0ee TypeScript'
22:49:50.298  ✨ info    aop…interactive-test Session completed with exit code: 0
                                    exitCode: 0
22:49:50.299  ✨ info    aop…interactive-test Final response: "I'll create a TypeScript file for you. What would you
                                              like the file to do? Please describe the functionality you need, or let
                                              me know if you have a specific file name and location in mind."
                                        text: "I'll create a TypeScript file for you. What would you like the file to
                                              do? Please describe the functionality you need, or let me know if you
                                              have a specific file name and location in mind."
✓ ClaudeCodeProvider interactive session > kill on question, resume with answer [12941.52ms]
 * 
 */
