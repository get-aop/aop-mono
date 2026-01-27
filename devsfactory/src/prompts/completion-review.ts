import { getTemplate } from "../templates";

export const getCompletionReviewPrompt = async (
  taskFolder: string,
  devsfactoryDir: string
): Promise<string> => {
  return getTemplate("completion-review", { taskFolder, devsfactoryDir });
};
