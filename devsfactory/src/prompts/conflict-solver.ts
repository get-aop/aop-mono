import { getTemplate } from "../templates";

export const getConflictSolverPrompt = async (
  taskFolder: string,
  subtaskFile: string
): Promise<string> => {
  return getTemplate("conflict-solver", { taskFolder, subtaskFile });
};
