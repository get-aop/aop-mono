import * as readline from "node:readline";
import { getLogger } from "@aop/infra";
import type { Question, QuestionOption } from "@aop/llm-provider";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("aop", "cli", "create-task");

export interface CreateTaskCommandOptions {
  debug?: boolean;
  raw?: boolean;
  maxQuestions?: number | string;
}

interface CreateTaskQuestionResponse {
  status: "question";
  sessionId: string;
  question: Question;
  questionCount: number;
  maxQuestions: number;
}

interface CreateTaskCompletedResponse {
  status: "completed";
  sessionId: string;
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

const displayQuestion = (question: Question, count: number, max: number): void => {
  const header = question.header ? ` [${question.header}]` : "";
  const suffix = max > 0 ? `/${max}` : "";
  process.stdout.write(`\n\nQuestion ${count}${suffix}${header}: ${question.question}\n`);

  if (question.options && question.options.length > 0) {
    process.stdout.write("\n");
    for (const [index, option] of question.options.entries()) {
      process.stdout.write(`${formatOptionLine(option, index)}\n`);
    }
    process.stdout.write("\n");
    if (question.multiSelect) {
      process.stdout.write("(Enter comma-separated numbers, or type a custom response)\n\n");
    } else {
      process.stdout.write("(Enter a number, or type a custom response)\n\n");
    }
  }
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

const resolveMaxQuestions = (value: unknown): number | undefined => {
  const resolved = normalizeMaxQuestions(value);
  if (resolved !== undefined) return resolved;

  const envValue = process.env.AOP_CREATE_TASK_MAX_QUESTIONS;
  return normalizeMaxQuestions(envValue);
};

const normalizeMaxQuestions = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.floor(num);
};

const exitWithError = (message: string, error: string): never => {
  logger.error(message, { error });
  process.exit(1);
};

const unwrapOrExit = <T>(result: FetchResult<T>, message: string): T => {
  if (!result.ok) {
    return exitWithError(message, result.error.error);
  }
  return result.data;
};

const startCreateTask = async (
  description: string,
  cwd: string,
  maxQuestions: number | undefined,
): Promise<CreateTaskStepResponse> => {
  const result = await fetchServer<CreateTaskStepResponse>("/api/create-task/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, cwd, maxQuestions }),
  });
  return unwrapOrExit(result, "Failed to start create-task: {error}");
};

const answerQuestion = async (
  sessionId: string,
  answer: string,
): Promise<CreateTaskStepResponse> => {
  const result = await fetchServer<CreateTaskStepResponse>(`/api/create-task/${sessionId}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  return unwrapOrExit(result, "Failed to continue create-task: {error}");
};

const finalizeCreateTask = async (
  sessionId: string,
  createChange: boolean,
): Promise<CreateTaskFinalizeResponse> => {
  const result = await fetchServer<CreateTaskFinalizeResponse>(
    `/api/create-task/${sessionId}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ createChange }),
    },
  );
  return unwrapOrExit(result, "Failed to finalize create-task: {error}");
};

const runQuestionLoop = async (
  rl: readline.Interface,
  initialStep: CreateTaskStepResponse,
  setSessionId: (sessionId: string) => void,
): Promise<CreateTaskCompletedResponse> => {
  let step = initialStep;
  setSessionId(step.sessionId);

  while (step.status === "question") {
    displayQuestion(step.question, step.questionCount, step.maxQuestions);
    const answer = await askQuestionAnswer(rl, step.question);
    step = await answerQuestion(step.sessionId, answer);
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

  const maxQuestions = resolveMaxQuestions(options.maxQuestions);
  const cwd = process.cwd();
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

    logger.info("Starting create-task brainstorming...");
    process.stdout.write("Thinking....\n");
    const startStep = await startCreateTask(taskDescription, cwd, maxQuestions);
    const completedStep = await runQuestionLoop(rl, startStep, (id) => {
      sessionId = id;
    });
    const shouldCreateChange = await askConfirmation(
      rl,
      "Create OpenSpec change from these requirements?",
    );
    process.stdout.write("Thinking....\n");
    const finalized = await finalizeCreateTask(completedStep.sessionId, shouldCreateChange);
    logFinalizeResult(finalized);
  } finally {
    rl.close();
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
};
