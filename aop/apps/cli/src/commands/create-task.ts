import * as readline from "node:readline";
import { getLogger } from "@aop/infra";
import type { Question, QuestionOption } from "@aop/llm-provider";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("aop", "cli", "create-task");

export interface CreateTaskCommandOptions {
  debug?: boolean;
  raw?: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const createSpinner = (label: string): { stop: () => void } => {
  const start = Date.now();
  let frame = 0;
  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const icon = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    process.stdout.write(`\r${icon} ${label} (${elapsed}s)`);
    frame++;
  }, 120);
  return {
    stop: () => {
      clearInterval(interval);
      process.stdout.write("\r\x1b[K");
    },
  };
};

interface CreateTaskQuestionResponse {
  status: "question";
  sessionId: string;
  question: Question;
  questionCount: number;
  maxQuestions: number;
  assistantOutput?: string;
}

interface CreateTaskCompletedResponse {
  status: "completed";
  sessionId: string;
  assistantOutput?: string;
  requirements: {
    title: string;
    description: string;
    requirements: string[];
    acceptanceCriteria: string[];
  };
}

type CreateTaskStepResponse = CreateTaskQuestionResponse | CreateTaskCompletedResponse;

interface CreateTaskFinalizeResponse {
  status: "success";
  sessionId: string;
  requirements: {
    title: string;
    description: string;
    requirements: string[];
    acceptanceCriteria: string[];
  };
  changeName?: string;
  warning?: string;
  draftPath?: string;
}

type FetchResult<T> = Awaited<ReturnType<typeof fetchServer<T>>>;

const formatOptionLine = (opt: QuestionOption, index: number): string => {
  const description = opt.description ? ` - ${opt.description}` : "";
  return `  ${index + 1}. ${opt.label}${description}`;
};

const translateNumberToLabel = (input: string, options: QuestionOption[]): string => {
  const num = Number.parseInt(input, 10);
  const option = options[num - 1];
  if (!Number.isNaN(num) && num >= 1 && num <= options.length && option) {
    return option.label;
  }
  return input;
};

const parseAnswer = (answer: string, question: Question): string => {
  const trimmed = answer.trim();
  const options = question.options;
  if (!options || options.length === 0) return trimmed;

  if (question.multiSelect) {
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .map((part) => translateNumberToLabel(part, options))
      .join(", ");
  }

  return translateNumberToLabel(trimmed, options);
};

const printAssistantOutput = (assistantOutput?: string): boolean => {
  if (!assistantOutput) return false;
  const trimmed = assistantOutput.trim();
  if (!trimmed) return false;
  process.stdout.write(`\n${trimmed}\n\n`);
  return true;
};

const printQuestionPrompt = (question: Question, count: number, max: number): void => {
  const header = question.header ? ` [${question.header}]` : "";
  const suffix = max > 0 ? `/${max}` : "";
  process.stdout.write(`\n\nQuestion ${count}${suffix}${header}: ${question.question}\n`);
};

const printQuestionOptions = (question: Question): void => {
  if (!question.options || question.options.length === 0) return;

  process.stdout.write("\n");
  for (const [index, option] of question.options.entries()) {
    process.stdout.write(`${formatOptionLine(option, index)}\n`);
  }
  process.stdout.write("\n");
  if (question.multiSelect) {
    process.stdout.write("(Enter comma-separated numbers, or type a custom response)\n\n");
    return;
  }
  process.stdout.write("(Enter a number, or type a custom response)\n\n");
};

const displayQuestion = (
  question: Question,
  count: number,
  max: number,
  assistantOutput?: string,
): void => {
  if (printAssistantOutput(assistantOutput)) return;
  printQuestionPrompt(question, count, max);
  printQuestionOptions(question);
};

const ask = (rl: readline.Interface, prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
};

const askQuestionAnswer = async (rl: readline.Interface, question: Question): Promise<string> => {
  const input = await ask(rl, "> ");
  return parseAnswer(input, question);
};

const askDescription = async (rl: readline.Interface): Promise<string> => {
  return ask(rl, "Enter task description: ");
};

const askConfirmation = async (rl: readline.Interface, prompt: string): Promise<boolean> => {
  const answer = (await ask(rl, `\n${prompt} (y/n) `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
};

const exitWithError = (message: string, error: string): never => {
  logger.error(message, { error });
  process.exit(1);
};

const unwrapOrExit = <T>(result: FetchResult<T>, message: string, debug?: boolean): T => {
  if (!result.ok) {
    if (debug) {
      logger.debug("Server error response: {response}", {
        response: JSON.stringify(result.error, null, 2),
      });
    }
    const assistantOutput = result.error.assistantOutput;
    if (typeof assistantOutput === "string" && assistantOutput.trim().length > 0) {
      printAssistantOutput(assistantOutput);
    }
    return exitWithError(message, result.error.error);
  }
  return result.data;
};

const startCreateTask = async (
  description: string,
  cwd: string,
  debug?: boolean,
): Promise<CreateTaskStepResponse> => {
  const spinner = createSpinner("Brainstorming");
  try {
    const result = await fetchServer<CreateTaskStepResponse>("/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, cwd }),
    });
    spinner.stop();
    if (debug) {
      logger.debug("Start response: {response}", {
        response: JSON.stringify(result, null, 2),
      });
    }
    return unwrapOrExit(result, "Failed to start create-task: {error}", debug);
  } catch (err) {
    spinner.stop();
    throw err;
  }
};

const answerQuestion = async (
  sessionId: string,
  answer: string,
  debug?: boolean,
): Promise<CreateTaskStepResponse> => {
  const spinner = createSpinner("Processing answer");
  try {
    const result = await fetchServer<CreateTaskStepResponse>(
      `/api/create-task/${sessionId}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      },
    );
    spinner.stop();
    if (debug) {
      logger.debug("Answer response: {response}", {
        response: JSON.stringify(result, null, 2),
      });
    }
    return unwrapOrExit(result, "Failed to continue create-task: {error}", debug);
  } catch (err) {
    spinner.stop();
    throw err;
  }
};

const finalizeCreateTask = async (
  sessionId: string,
  createChange: boolean,
  debug?: boolean,
): Promise<CreateTaskFinalizeResponse> => {
  const spinner = createSpinner("Finalizing");
  try {
    const result = await fetchServer<CreateTaskFinalizeResponse>(
      `/api/create-task/${sessionId}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createChange }),
      },
    );
    spinner.stop();
    if (debug) {
      logger.debug("Finalize response: {response}", {
        response: JSON.stringify(result, null, 2),
      });
    }
    return unwrapOrExit(result, "Failed to finalize create-task: {error}", debug);
  } catch (err) {
    spinner.stop();
    throw err;
  }
};

const runQuestionLoop = async (
  rl: readline.Interface,
  initialStep: CreateTaskStepResponse,
  setSessionId: (sessionId: string) => void,
  debug?: boolean,
): Promise<CreateTaskCompletedResponse> => {
  let step = initialStep;
  setSessionId(step.sessionId);

  while (step.status === "question") {
    displayQuestion(step.question, step.questionCount, step.maxQuestions, step.assistantOutput);
    const answer = await askQuestionAnswer(rl, step.question);
    step = await answerQuestion(step.sessionId, answer, debug);
    setSessionId(step.sessionId);
  }

  return step;
};

const logFinalizeResult = (result: CreateTaskFinalizeResponse): void => {
  if (result.warning) {
    logger.warn(result.warning);
  }
  if (result.draftPath) {
    logger.info("Draft saved to: {path}", { path: result.draftPath });
  }
  if (result.changeName) {
    logger.info("Change created: {changeName}", { changeName: result.changeName });
    return;
  }
  logger.info("Brainstorming complete. Requirements saved.");
};

export const createTaskCommand = async (
  description?: string,
  options: CreateTaskCommandOptions = {},
): Promise<void> => {
  await requireServer();
  const cwd = process.cwd();
  const debug = options.debug;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let sessionId = "";

  const cancel = async (): Promise<void> => {
    if (sessionId) {
      await fetchServer(`/api/create-task/${sessionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    }
    rl.close();
    process.exit(130);
  };

  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);

  try {
    const taskDescription = description ?? (await askDescription(rl));
    if (!taskDescription.trim()) {
      logger.error("No task description provided");
      process.exit(1);
    }

    const startStep = await startCreateTask(taskDescription, cwd, debug);
    const completedStep = await runQuestionLoop(
      rl,
      startStep,
      (id) => {
        sessionId = id;
      },
      debug,
    );
    printAssistantOutput(completedStep.assistantOutput);
    const shouldCreateChange = await askConfirmation(
      rl,
      "Create OpenSpec change from these requirements?",
    );
    const finalized = await finalizeCreateTask(completedStep.sessionId, shouldCreateChange, debug);
    logFinalizeResult(finalized);
  } finally {
    rl.close();
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
};
