import { type BackgroundRunnerSession, runWithRetry } from "../session/background-runner.ts";
import type { BrainstormingResult } from "./brainstorm-parser.ts";
import { saveDraft } from "./draft.ts";

const DEFAULT_BACKGROUND_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_BRAINSTORM_COMMAND = "/aop:brainstorming";

const COMPLETION_INSTRUCTIONS =
  "When finished, output ONLY the [BRAINSTORM_COMPLETE] marker and raw JSON on separate lines. Do NOT wrap in code fences. Do NOT add any extra text before or after. Do NOT repeat the marker.";

export interface FinalizeSuccessResult {
  changeName?: string;
  warning?: string;
  draftPath?: string;
}

/* --- Public API --- */

export const getBrainstormCommand = (depsCommand?: string, envCommand?: string): string =>
  depsCommand ?? envCommand ?? DEFAULT_BRAINSTORM_COMMAND;

export const buildBrainstormingPrompt = (description: string, command: string): string => {
  return `${command}

Task to brainstorm: ${description}

${COMPLETION_INSTRUCTIONS}`;
};

export const buildContinuationPrompt = (attemptNumber: number): string => {
  const attemptText = attemptNumber > 1 ? `This is attempt ${attemptNumber} to continue. ` : "";
  return `Please continue the brainstorming session. ${attemptText}If you have gathered enough information, please conclude with the [BRAINSTORM_COMPLETE] marker and the requirements JSON. Otherwise, ask your next clarifying question. ${COMPLETION_INSTRUCTIONS}`;
};

export const toKebabCase = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
};

export const normalizeMaxQuestions = (value: number | undefined): number => {
  // Temporarily disable hard question caps so brainstorming continues until completion marker.
  // The cap input is intentionally ignored during this period.
  void value;
  return 0;
};

export const finalizeWithChange = async (
  session: BackgroundRunnerSession & { cwd: string },
  requirements: BrainstormingResult,
  detectQuestion: (output: string) => boolean,
): Promise<FinalizeSuccessResult> => {
  const changeName = toKebabCase(requirements.title);
  const bgRunnerOpts = {
    timeoutMs: DEFAULT_BACKGROUND_TIMEOUT_MS,
    detectQuestion,
  };

  const newResult = await runWithRetry(session, "/opsx:new", {
    ...bgRunnerOpts,
    autoAnswer: changeName,
  });

  if (!newResult.success) {
    const draftPath = await saveDraft(session.cwd, changeName, requirements);
    return {
      warning: "Change creation failed after retries. Draft saved.",
      draftPath,
    };
  }

  session.claudeSessionId = newResult.sessionId ?? session.claudeSessionId;
  const ffResult = await runWithRetry(session, "/opsx:ff", {
    ...bgRunnerOpts,
    autoAnswer: changeName,
  });

  if (!ffResult.success) {
    return {
      changeName,
      warning: "Change created, but artifact generation failed.",
    };
  }

  return { changeName };
};
