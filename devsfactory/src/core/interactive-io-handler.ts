import * as readline from "node:readline";

export interface IOHandler {
  writeText: (text: string) => void;
  writeToolUse: (name: string, input: unknown) => void;
  writeStatus: (
    message: string,
    type: "info" | "success" | "warning" | "error"
  ) => void;
  askUser: (question: string, options?: AskUserOptions) => Promise<string>;
  close: () => void;
}

export interface AskUserOptions {
  choices?: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  header?: string;
}

export interface TerminalIOHandlerOptions {
  silent?: boolean;
  showToolUse?: boolean;
}

const colors = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m"
};

export const createTerminalIOHandler = (
  options: TerminalIOHandlerOptions = {}
): IOHandler => {
  const { silent = false, showToolUse = true } = options;

  let rl: readline.Interface | null = null;

  const getReadline = (): readline.Interface => {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }
    return rl;
  };

  const formatToolUse = (name: string, input: unknown): string => {
    const { dim, reset, cyan } = colors;
    const inputObj = (input ?? {}) as Record<string, unknown>;

    switch (name) {
      case "read_file":
        return `${cyan}📖 Reading${reset} ${dim}${inputObj.path}${reset}`;
      case "write_file":
        return `${cyan}✏️  Writing${reset} ${dim}${inputObj.path}${reset}`;
      case "bash": {
        const cmd = String(inputObj.command || "").slice(0, 60);
        return `${cyan}💻 Running${reset} ${dim}${cmd}${cmd.length >= 60 ? "..." : ""}${reset}`;
      }
      case "glob":
        return `${cyan}🔍 Searching${reset} ${dim}${inputObj.pattern}${reset}`;
      case "grep":
        return `${cyan}🔎 Grep${reset} ${dim}${inputObj.pattern}${reset}`;
      case "ask_user":
        return `${cyan}❓ Question${reset}`;
      default:
        return `${cyan}🔧 ${name}${reset}`;
    }
  };

  return {
    writeText: (text: string) => {
      if (!silent) {
        process.stdout.write(text);
      }
    },

    writeToolUse: (name: string, input: unknown) => {
      if (!silent && showToolUse && name !== "ask_user") {
        console.log(`\n${formatToolUse(name, input)}`);
      }
    },

    writeStatus: (
      message: string,
      type: "info" | "success" | "warning" | "error"
    ) => {
      if (silent) return;

      const { dim, reset, green, yellow, red, cyan } = colors;
      const colorMap = {
        info: cyan,
        success: green,
        warning: yellow,
        error: red
      };
      const symbolMap = {
        info: "●",
        success: "✓",
        warning: "⚠",
        error: "✗"
      };

      console.log(
        `${colorMap[type]}${symbolMap[type]}${reset} ${dim}${message}${reset}`
      );
    },

    askUser: async (
      question: string,
      options?: AskUserOptions
    ): Promise<string> => {
      const { dim, reset, cyan } = colors;
      const separator = "─".repeat(50);

      console.log(`\n${cyan}${separator}${reset}`);
      if (options?.header) {
        console.log(`${dim}[${options.header}]${reset}`);
      }
      console.log(question);
      console.log(`${cyan}${separator}${reset}`);

      if (options?.choices && options.choices.length > 0) {
        const allChoices = [
          ...options.choices,
          { label: "Other", description: "Enter custom response" }
        ];

        allChoices.forEach((choice, index) => {
          console.log(
            `  ${index + 1}) ${choice.label} - ${choice.description}`
          );
        });
        console.log();

        if (options.multiSelect) {
          return getMultiSelectAnswer(allChoices, getReadline());
        }
        return getSingleSelectAnswer(allChoices, getReadline());
      }

      return new Promise((resolve) => {
        getReadline().question(`${dim}> ${reset}`, (answer) => {
          resolve(answer.trim());
        });
      });
    },

    close: () => {
      if (rl) {
        rl.close();
        rl = null;
      }
    }
  };
};

const getSingleSelectAnswer = async (
  options: Array<{ label: string; description: string }>,
  rl: readline.Interface
): Promise<string> => {
  const { dim, reset } = colors;

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(`${dim}Select (1-${options.length}): ${reset}`, (answer) => {
        const selection = parseInt(answer.trim(), 10);

        if (
          Number.isNaN(selection) ||
          selection < 1 ||
          selection > options.length
        ) {
          console.log(`Please enter a number between 1 and ${options.length}`);
          ask();
          return;
        }

        if (selection === options.length) {
          rl.question(`${dim}Enter your response: ${reset}`, (customAnswer) => {
            resolve(customAnswer.trim());
          });
          return;
        }

        resolve(options[selection - 1]!.label);
      });
    };

    ask();
  });
};

const getMultiSelectAnswer = async (
  options: Array<{ label: string; description: string }>,
  rl: readline.Interface
): Promise<string> => {
  const { dim, reset } = colors;
  console.log(`${dim}(Enter comma-separated numbers, e.g., 1,3)${reset}`);

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(
        `${dim}Select (1-${options.length}): ${reset}`,
        async (answer) => {
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

          if (!valid) {
            ask();
            return;
          }

          const selectedLabels: string[] = [];
          for (const sel of selections) {
            if (sel === options.length) {
              const customAnswer = await new Promise<string>((res) => {
                rl.question(`${dim}Enter your response: ${reset}`, res);
              });
              selectedLabels.push(customAnswer.trim());
            } else {
              selectedLabels.push(options[sel - 1]!.label);
            }
          }

          resolve(selectedLabels.join(", "));
        }
      );
    };

    ask();
  });
};

export const createTestIOHandler = (): IOHandler & {
  outputs: string[];
  toolUses: Array<{ name: string; input: unknown }>;
  statuses: Array<{ message: string; type: string }>;
  mockResponses: string[];
} => {
  const outputs: string[] = [];
  const toolUses: Array<{ name: string; input: unknown }> = [];
  const statuses: Array<{ message: string; type: string }> = [];
  const mockResponses: string[] = [];

  return {
    outputs,
    toolUses,
    statuses,
    mockResponses,

    writeText: (text: string) => {
      outputs.push(text);
    },

    writeToolUse: (name: string, input: unknown) => {
      toolUses.push({ name, input });
    },

    writeStatus: (
      message: string,
      type: "info" | "success" | "warning" | "error"
    ) => {
      statuses.push({ message, type });
    },

    askUser: async (
      _question: string,
      _options?: AskUserOptions
    ): Promise<string> => {
      const response = mockResponses.shift();
      return response ?? "";
    },

    close: () => {}
  };
};
