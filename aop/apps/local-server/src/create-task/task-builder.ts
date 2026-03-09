import type { BackgroundRunnerSession } from "../session/background-runner.ts";
import { scaffoldTaskFromBrainstorm, toTaskSlug } from "../task-docs/scaffold.ts";
import type { BrainstormingResult } from "./brainstorm-parser.ts";
import { saveDraft } from "./draft.ts";

const COMPLETION_INSTRUCTIONS =
  "When finished, output ONLY the [BRAINSTORM_COMPLETE] marker and raw JSON on separate lines. Do NOT wrap in code fences. Do NOT add any extra text before or after. Do NOT repeat the marker.";
const BRAINSTORM_INSTRUCTIONS =
  "You are helping define a repo-local task. Ask focused clarifying questions one at a time until you have enough context to produce the final JSON requirements payload.";

export interface FinalizeSuccessResult {
  changeName?: string;
  warning?: string;
  draftPath?: string;
}

/* --- Public API --- */

export const buildBrainstormingPrompt = (description: string): string =>
  `${BRAINSTORM_INSTRUCTIONS}

Task to define: ${description}

${COMPLETION_INSTRUCTIONS}`;

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
  void session;
  void detectQuestion;

  const changeName = toTaskSlug(requirements.title);

  try {
    const result = await scaffoldTaskFromBrainstorm(session.cwd, changeName, requirements);
    return { changeName: result.taskName };
  } catch {
    const draftPath = await saveDraft(session.cwd, changeName, requirements);
    return {
      warning: "Task creation failed. Draft saved.",
      draftPath,
    };
  }
};
