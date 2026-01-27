import { dirname } from "node:path";
import { getTemplate } from "../templates";

export const getImplementationPrompt = async (
  subtaskPath: string
): Promise<string> => {
  const taskDir = dirname(subtaskPath);
  return getTemplate("implementation", { subtaskPath, taskDir });
};
