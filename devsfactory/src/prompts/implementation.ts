import { getTemplate } from "../templates";

export const getImplementationPrompt = async (
  subtaskTitle: string,
  subtaskPath: string
): Promise<string> => {
  return getTemplate("implementation", { subtaskTitle, subtaskPath });
};
