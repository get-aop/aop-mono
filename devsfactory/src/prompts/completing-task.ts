import { getTemplate } from "../templates";

export const getCompletingTaskPrompt = async (
  taskFolder: string,
  devsfactoryDir: string
): Promise<string> => {
  return getTemplate("completing-task", { taskFolder, devsfactoryDir });
};
