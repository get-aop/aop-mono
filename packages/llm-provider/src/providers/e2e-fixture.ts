import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LLMProvider, RunOptions, RunResult } from "../types";

const TASK_PATH_REGEX = /- \*\*Task Path\*\*: ([^\n]+)/;
const SIGNAL_PRIORITY = [
  "ALL_TASKS_DONE",
  "CLEANUP_COMPLETE",
  "REVIEW_PASSED",
  "FIX_COMPLETE",
  "CHUNK_DONE",
] as const;
const CHECKBOX_REGEX = /^-\s+\[\s\]\s+/gm;
const FILE_WITH_CONTENT_REGEX =
  /Create\s+`?([^`"\n]+?\.[a-z0-9._-]+)`?\s+in the repository root(?:\s+with content|\s+containing)\s+["`]([^"`\n]+)["`]/i;
const FILE_REFERENCE_REGEX = /`([^`\n]+?\.[a-z0-9._-]+)`/i;
const WRITE_CONTENT_REGEX = /(?:Write|contains?)\s+["`]([^"`\n]+)["`]/i;

export class E2EFixtureProvider implements LLMProvider {
  readonly name = "e2e-fixture";

  async run(options: RunOptions): Promise<RunResult> {
    const signal = pickSignal(options.prompt);
    const taskDir = extractTaskDir(options.prompt);

    if (options.cwd && taskDir) {
      await applyFixtureChanges(taskDir, options.cwd);
    }

    if (options.logFilePath) {
      await writeFixtureLog(options.logFilePath, signal);
    }

    return { exitCode: 0 };
  }
}

const extractTaskDir = (prompt: string): string | null => {
  const match = prompt.match(TASK_PATH_REGEX);
  return match?.[1]?.trim() ?? null;
};

const pickSignal = (prompt: string): string => {
  for (const signal of SIGNAL_PRIORITY) {
    if (prompt.includes(`<aop>${signal}</aop>`)) {
      return signal;
    }
  }

  return "REVIEW_PASSED";
};

const applyFixtureChanges = async (taskDir: string, worktreePath: string): Promise<void> => {
  const taskText = await loadTaskText(taskDir);
  const fileInstruction = extractFileInstruction(taskText);
  if (!fileInstruction) {
    await markTaskDocsDone(taskDir);
    return;
  }

  const targetPath = join(worktreePath, fileInstruction.path);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${fileInstruction.content}\n`);
  await markTaskDocsDone(taskDir);
};

const loadTaskText = async (taskDir: string): Promise<string> => {
  const files = ["tasks.md", "task.md", "proposal.md"];
  const contents = await Promise.all(
    files.map(async (file) => {
      const path = join(taskDir, file);
      try {
        return await readFile(path, "utf-8");
      } catch {
        return "";
      }
    }),
  );

  return contents.filter(Boolean).join("\n");
};

const extractFileInstruction = (
  text: string,
): {
  path: string;
  content: string;
} | null => {
  const explicitMatch = text.match(FILE_WITH_CONTENT_REGEX);
  if (explicitMatch?.[1] && explicitMatch[2]) {
    return {
      path: explicitMatch[1].trim(),
      content: explicitMatch[2].trim(),
    };
  }

  const fileMatch = text.match(FILE_REFERENCE_REGEX);
  const contentMatch = text.match(WRITE_CONTENT_REGEX);
  if (fileMatch?.[1] && contentMatch?.[1]) {
    return {
      path: fileMatch[1].trim(),
      content: contentMatch[1].trim(),
    };
  }

  return null;
};

const markTaskDocsDone = async (taskDir: string): Promise<void> => {
  await markTaskDocDone(join(taskDir, "task.md"));
  await markChecklistDone(join(taskDir, "tasks.md"));
  await markSubtasksDone(taskDir);
};

const markTaskDocDone = async (taskPath: string): Promise<void> => {
  try {
    const content = await readFile(taskPath, "utf-8");
    const updated = content.replace(/^status:\s+\w+$/m, "status: DONE");
    if (updated !== content) {
      await writeFile(taskPath, updated);
    }
  } catch {
    // Ignore fixture docs that do not include task.md
  }
};

const markChecklistDone = async (tasksPath: string): Promise<void> => {
  try {
    const content = await readFile(tasksPath, "utf-8");
    const updated = content.replace(CHECKBOX_REGEX, "- [x] ");
    if (updated !== content) {
      await writeFile(tasksPath, updated);
    }
  } catch {
    // Ignore fixture docs that do not include tasks.md
  }
};

const markSubtasksDone = async (taskDir: string): Promise<void> => {
  let files: string[] = [];

  try {
    files = await readdir(taskDir);
  } catch {
    return;
  }

  await Promise.all(
    files
      .filter((file) => /^\d{3}-.*\.md$/.test(file))
      .map(async (file) => {
        const path = join(taskDir, file);
        const fileStat = await stat(path).catch(() => null);
        if (!fileStat?.isFile()) return;

        const content = await readFile(path, "utf-8");
        let updated = content.replace(/^status:\s+\w+$/m, "status: DONE");
        if (!updated.includes("### Result")) {
          updated = `${updated.trimEnd()}\n\n### Result\nCompleted by deterministic e2e fixture provider.\n`;
        }

        if (updated !== content) {
          await writeFile(path, updated);
        }
      }),
  );
};

const writeFixtureLog = async (logFilePath: string, signal: string): Promise<void> => {
  const assistantText = `Deterministic e2e fixture run complete.\n<aop>${signal}</aop>`;
  const events = [
    { type: "thread.started", thread_id: "e2e-fixture-thread" },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: assistantText,
      },
    },
    {
      type: "turn.completed",
      "last-assistant-message": assistantText,
    },
  ];

  await mkdir(dirname(logFilePath), { recursive: true });
  await writeFile(logFilePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
};
