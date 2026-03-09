import * as readline from "node:readline";
import { getLogger } from "@aop/infra";
import type { Question, QuestionOption } from "@aop/llm-provider";
import { createSpinner } from "../format/spinner.ts";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "create-task");
type CreateTaskLogger = Pick<typeof logger, "debug" | "error" | "info" | "warn">;

interface CreateTaskRuntime {
  createInterface: typeof readline.createInterface;
  createSpinner: typeof createSpinner;
  cwd: () => string;
  exit: typeof process.exit;
  fetchServer: typeof fetchServer;
  logger: CreateTaskLogger;
  offSignal: typeof process.off;
  onSignal: typeof process.on;
  requireServer: typeof requireServer;
  writeStdout: (chunk: string) => void;
}

type CreateTaskRuntimeOverrides = Partial<CreateTaskRuntime>;

const createRuntime = (overrides: CreateTaskRuntimeOverrides = {}): CreateTaskRuntime => {
  return {
    createInterface: readline.createInterface,
    createSpinner,
    cwd: () => process.cwd(),
    exit: process.exit,
    fetchServer,
    logger,
    offSignal: process.off,
    onSignal: process.on,
    requireServer,
    writeStdout: (chunk: string) => {
      process.stdout.write(chunk);
    },
    ...overrides,
  };
};

export interface CreateTaskCommandOptions {
  debug?: boolean;
  raw?: boolean;
}

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

const printAssistantOutput = (runtime: CreateTaskRuntime, assistantOutput?: string): boolean => {
  if (!assistantOutput) return false;
  const trimmed = assistantOutput.trim();
  if (!trimmed) return false;
  runtime.writeStdout(`\n${trimmed}\n\n`);
  return true;
};

const printQuestionPrompt = (
  runtime: CreateTaskRuntime,
  question: Question,
  count: number,
  max: number,
): void => {
  const header = question.header ? ` [${question.header}]` : "";
  const suffix = max > 0 ? `/${max}` : "";
  runtime.writeStdout(`\n\nQuestion ${count}${suffix}${header}: ${question.question}\n`);
};

const printQuestionOptions = (runtime: CreateTaskRuntime, question: Question): void => {
  if (!question.options || question.options.length === 0) return;

  runtime.writeStdout("\n");
  for (const [index, option] of question.options.entries()) {
    runtime.writeStdout(`${formatOptionLine(option, index)}\n`);
  }
  runtime.writeStdout("\n");
  if (question.multiSelect) {
    runtime.writeStdout("(Enter comma-separated numbers, or type a custom response)\n\n");
    return;
  }
  runtime.writeStdout("(Enter a number, or type a custom response)\n\n");
};

const displayQuestion = (
  runtime: CreateTaskRuntime,
  question: Question,
  count: number,
  max: number,
  assistantOutput?: string,
): void => {
  if (printAssistantOutput(runtime, assistantOutput)) return;
  printQuestionPrompt(runtime, question, count, max);
  printQuestionOptions(runtime, question);
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

const exitWithError = (runtime: CreateTaskRuntime, message: string, error: string): never => {
  runtime.logger.error(message, { error });
  return runtime.exit(1);
};

const unwrapOrExit = <T>(
  runtime: CreateTaskRuntime,
  result: FetchResult<T>,
  message: string,
  debug?: boolean,
): T => {
  if (!result.ok) {
    if (debug) {
      runtime.logger.debug("Server error response: {response}", {
        response: JSON.stringify(result.error, null, 2),
      });
    }
    const assistantOutput = result.error.assistantOutput;
    if (typeof assistantOutput === "string" && assistantOutput.trim().length > 0) {
      printAssistantOutput(runtime, assistantOutput);
    }
    return exitWithError(runtime, message, result.error.error);
  }
  return result.data;
};

const startCreateTask = async (
  runtime: CreateTaskRuntime,
  description: string,
  cwd: string,
  debug?: boolean,
): Promise<CreateTaskStepResponse> => {
  const spinner = runtime.createSpinner("Brainstorming");
  try {
    const result = await runtime.fetchServer<CreateTaskStepResponse>("/api/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, cwd }),
    });
    spinner.stop();
    if (debug) {
      runtime.logger.debug("Start response: {response}", {
        response: JSON.stringify(result, null, 2),
      });
    }
    return unwrapOrExit(runtime, result, "Failed to start create-task: {error}", debug);
  } catch (err) {
    spinner.stop();
    throw err;
  }
};

const answerQuestion = async (
  runtime: CreateTaskRuntime,
  sessionId: string,
  answer: string,
  debug?: boolean,
): Promise<CreateTaskStepResponse> => {
  const spinner = runtime.createSpinner("Processing answer");
  try {
    const result = await runtime.fetchServer<CreateTaskStepResponse>(
      `/api/create-task/${sessionId}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      },
    );
    spinner.stop();
    if (debug) {
      runtime.logger.debug("Answer response: {response}", {
        response: JSON.stringify(result, null, 2),
      });
    }
    return unwrapOrExit(runtime, result, "Failed to continue create-task: {error}", debug);
  } catch (err) {
    spinner.stop();
    throw err;
  }
};

const finalizeCreateTask = async (
  runtime: CreateTaskRuntime,
  sessionId: string,
  createChange: boolean,
  debug?: boolean,
): Promise<CreateTaskFinalizeResponse> => {
  const spinner = runtime.createSpinner("Finalizing");
  try {
    const result = await runtime.fetchServer<CreateTaskFinalizeResponse>(
      `/api/create-task/${sessionId}/finalize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createChange }),
      },
    );
    spinner.stop();
    if (debug) {
      runtime.logger.debug("Finalize response: {response}", {
        response: JSON.stringify(result, null, 2),
      });
    }
    return unwrapOrExit(runtime, result, "Failed to finalize create-task: {error}", debug);
  } catch (err) {
    spinner.stop();
    throw err;
  }
};

const runQuestionLoop = async (
  runtime: CreateTaskRuntime,
  rl: readline.Interface,
  initialStep: CreateTaskStepResponse,
  setSessionId: (sessionId: string) => void,
  debug?: boolean,
): Promise<CreateTaskCompletedResponse> => {
  let step = initialStep;
  setSessionId(step.sessionId);

  while (step.status === "question") {
    displayQuestion(
      runtime,
      step.question,
      step.questionCount,
      step.maxQuestions,
      step.assistantOutput,
    );
    const answer = await askQuestionAnswer(rl, step.question);
    step = await answerQuestion(runtime, step.sessionId, answer, debug);
    setSessionId(step.sessionId);
  }

  return step;
};

const logFinalizeResult = (
  runtime: CreateTaskRuntime,
  result: CreateTaskFinalizeResponse,
): void => {
  if (result.warning) {
    runtime.logger.warn(result.warning);
  }
  if (result.draftPath) {
    runtime.logger.info("Draft saved to: {path}", { path: result.draftPath });
  }
  if (result.changeName) {
    runtime.logger.info("Change created: {changeName}", { changeName: result.changeName });
    return;
  }
  runtime.logger.info("Brainstorming complete. Requirements saved.");
};

export const createTaskCommand = async (
  description?: string,
  options: CreateTaskCommandOptions = {},
  runtimeOverrides: CreateTaskRuntimeOverrides = {},
): Promise<void> => {
  const runtime = createRuntime(runtimeOverrides);
  await runtime.requireServer();
  const cwd = runtime.cwd();
  const debug = options.debug;
  const rl = runtime.createInterface({ input: process.stdin, output: process.stdout });

  let sessionId = "";

  const cancel = async (): Promise<void> => {
    if (sessionId) {
      await runtime.fetchServer(`/api/create-task/${sessionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    }
    rl.close();
    runtime.exit(130);
  };

  runtime.onSignal("SIGINT", cancel);
  runtime.onSignal("SIGTERM", cancel);

  try {
    const taskDescription = description ?? (await askDescription(rl));
    if (!taskDescription.trim()) {
      runtime.logger.error("No task description provided");
      runtime.exit(1);
    }

    const startStep = await startCreateTask(runtime, taskDescription, cwd, debug);
    const completedStep = await runQuestionLoop(
      runtime,
      rl,
      startStep,
      (id) => {
        sessionId = id;
      },
      debug,
    );
    printAssistantOutput(runtime, completedStep.assistantOutput);
    const shouldCreateChange = await askConfirmation(
      rl,
      "Create repo task documents from these requirements?",
    );
    const finalized = await finalizeCreateTask(
      runtime,
      completedStep.sessionId,
      shouldCreateChange,
      debug,
    );
    logFinalizeResult(runtime, finalized);
  } finally {
    rl.close();
    runtime.offSignal("SIGINT", cancel);
    runtime.offSignal("SIGTERM", cancel);
  }
};
