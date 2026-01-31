import * as readline from "node:readline";
import type {
  AskUserQuestionInput,
  ClaudeEventHandler,
  ClaudeInitEvent,
  ClaudeResultEvent
} from "./claude-events";
import type { IOHandler } from "./claude-session";

export const createCliIOHandler = (): IOHandler => ({
  onOutput: (data: Uint8Array) => {
    process.stdout.write(data);
  },
  onError: (data: Uint8Array) => {
    process.stderr.write(data);
  },
  getInput: () => {
    if (!process.stdin.readable) return null;

    return new ReadableStream({
      start(controller) {
        process.stdin.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        process.stdin.on("end", () => {
          controller.close();
        });
        process.stdin.on("error", (err) => {
          controller.error(err);
        });
      }
    });
  }
});

export interface CliEventHandlerOptions {
  showToolUse?: boolean;
  showInit?: boolean;
  silent?: boolean;
}

export interface ReadlineProvider {
  question: (prompt: string) => Promise<string>;
  close: () => void;
}

export const createReadlineProvider = (): ReadlineProvider => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return {
    question: (prompt: string) =>
      new Promise((resolve) => {
        rl.question(prompt, resolve);
      }),
    close: () => rl.close()
  };
};

export const createCliEventHandler = (
  options: CliEventHandlerOptions = {},
  readlineProvider?: ReadlineProvider
): ClaudeEventHandler => {
  const { showToolUse = false, showInit = false, silent = false } = options;
  let rlProvider: ReadlineProvider | null = null;

  const getReadlineProvider = (): ReadlineProvider => {
    if (readlineProvider) return readlineProvider;
    if (!rlProvider) {
      rlProvider = createReadlineProvider();
    }
    return rlProvider;
  };

  return {
    onInit: (event: ClaudeInitEvent) => {
      if (showInit && !silent) {
        console.log(`Session: ${event.session_id}`);
        console.log(`Model: ${event.model}`);
      }
    },

    onText: (text: string) => {
      if (!silent) {
        process.stdout.write(text);
      }
    },

    onAskQuestion: async (
      _toolUseId: string,
      input: AskUserQuestionInput
    ): Promise<string> => {
      const answers: Record<string, string> = {};

      for (const question of input.questions) {
        const answer = await renderQuestionAndGetAnswer(
          question,
          getReadlineProvider()
        );
        answers[question.header] = answer;
      }

      return JSON.stringify({ answers });
    },

    onToolUse: (_toolUseId: string, name: string, _input: unknown) => {
      if (showToolUse && !silent) {
        console.log(`\n[Tool: ${name}]`);
      }
    },

    onResult: (event: ClaudeResultEvent) => {
      if (!silent) {
        if (event.subtype === "success") {
          console.log("\n\nSession completed successfully.");
        } else {
          console.log(`\n\nSession ended with error: ${event.result}`);
        }
        if (event.total_cost_usd > 0) {
          console.log(`Cost: $${event.total_cost_usd.toFixed(4)}`);
        }
      }

      if (rlProvider) {
        rlProvider.close();
        rlProvider = null;
      }
    },

    onError: (error: Error) => {
      if (!silent) {
        console.error(`\nError: ${error.message}`);
      }

      if (rlProvider) {
        rlProvider.close();
        rlProvider = null;
      }
    }
  };
};

const renderQuestionAndGetAnswer = async (
  question: AskUserQuestionInput["questions"][0],
  rl: ReadlineProvider
): Promise<string> => {
  const separator = "─".repeat(40);

  console.log(`\n${separator}`);
  console.log(`[${question.header}] ${question.question}`);
  console.log(separator);

  const options = [
    ...question.options,
    { label: "Other", description: "Enter custom response" }
  ];

  options.forEach((option, index) => {
    console.log(`  ${index + 1}) ${option.label} - ${option.description}`);
  });

  console.log();

  if (question.multiSelect) {
    return getMultiSelectAnswer(options, rl);
  }

  return getSingleSelectAnswer(options, rl);
};

const getSingleSelectAnswer = async (
  options: Array<{ label: string; description: string }>,
  rl: ReadlineProvider
): Promise<string> => {
  while (true) {
    const answer = await rl.question(`Select (1-${options.length}): `);
    const selection = parseInt(answer.trim(), 10);

    if (
      Number.isNaN(selection) ||
      selection < 1 ||
      selection > options.length
    ) {
      console.log(`Please enter a number between 1 and ${options.length}`);
      continue;
    }

    if (selection === options.length) {
      const customAnswer = await rl.question("Enter your response: ");
      return customAnswer.trim();
    }

    return options[selection - 1]!.label;
  }
};

const getMultiSelectAnswer = async (
  options: Array<{ label: string; description: string }>,
  rl: ReadlineProvider
): Promise<string> => {
  console.log("(Enter comma-separated numbers, e.g., 1,3)");

  while (true) {
    const answer = await rl.question(`Select (1-${options.length}): `);
    const parts = answer.split(",").map((p) => p.trim());
    const selections: number[] = [];

    let valid = true;
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (Number.isNaN(num) || num < 1 || num > options.length) {
        console.log(
          `Invalid selection: ${part}. Please enter numbers between 1 and ${options.length}`
        );
        valid = false;
        break;
      }
      selections.push(num);
    }

    if (!valid) continue;

    const selectedLabels: string[] = [];
    for (const sel of selections) {
      if (sel === options.length) {
        const customAnswer = await rl.question("Enter your response: ");
        selectedLabels.push(customAnswer.trim());
      } else {
        selectedLabels.push(options[sel - 1]!.label);
      }
    }

    return selectedLabels.join(", ");
  }
};
