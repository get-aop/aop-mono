import { getTemplate } from "../templates";

export const getPlanningPrompt = async (taskPath: string): Promise<string> => {
  return getTemplate("planning", { taskPath });
};
