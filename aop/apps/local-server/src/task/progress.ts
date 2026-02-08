import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";

const CHECKED_RE = /^\s*-\s+\[[xX]\]\s/;
const UNCHECKED_RE = /^\s*-\s+\[ \]\s/;

export const parseTaskProgress = (content: string): { completed: number; total: number } => {
  let completed = 0;
  let total = 0;

  for (const line of content.split("\n")) {
    if (CHECKED_RE.test(line)) {
      completed++;
      total++;
    } else if (UNCHECKED_RE.test(line)) {
      total++;
    }
  }

  return { completed, total };
};

export const readTaskProgress = (
  repoId: string,
  changePath: string,
): { completed: number; total: number } | undefined => {
  const tasksFile = join(aopPaths.repoDir(repoId), changePath, "tasks.md");
  try {
    const content = readFileSync(tasksFile, "utf-8");
    return parseTaskProgress(content);
  } catch {
    return undefined;
  }
};
