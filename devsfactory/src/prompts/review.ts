import { getTemplate } from "../templates";

export const getReviewPrompt = async (
  subtaskPath: string,
  reviewPath: string
): Promise<string> => {
  return getTemplate("review", { subtaskPath, reviewPath });
};
