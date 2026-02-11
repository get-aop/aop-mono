import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import type { BrainstormingResult } from "./brainstorm-parser.ts";

const logger = getLogger("create-task-draft");

/** @deprecated Use `BrainstormingResult` from brainstorm-parser.ts */
export type BrainstormRequirements = BrainstormingResult;

export interface DraftFile {
  path: string;
  requirements: BrainstormingResult;
  createdAt: string;
}

const getDraftsDir = (repoRoot: string): string => join(repoRoot, "openspec", "changes", ".drafts");

export const saveDraft = async (
  repoRoot: string,
  changeName: string,
  requirements: BrainstormingResult,
): Promise<string> => {
  const draftsDir = getDraftsDir(repoRoot);
  await mkdir(draftsDir, { recursive: true });

  const draftPath = join(draftsDir, `${changeName}.json`);
  const draftFile: DraftFile = {
    path: draftPath,
    requirements,
    createdAt: new Date().toISOString(),
  };

  await Bun.write(draftPath, JSON.stringify(draftFile, null, 2));
  logger.info("Draft saved", { path: draftPath, changeName });

  return draftPath;
};

export const loadDraft = async (
  repoRoot: string,
  changeName: string,
): Promise<DraftFile | null> => {
  const draftPath = join(getDraftsDir(repoRoot), `${changeName}.json`);
  const file = Bun.file(draftPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    return (await file.json()) as DraftFile;
  } catch (error) {
    logger.warn("Failed to load draft", { path: draftPath, error });
    return null;
  }
};

export const deleteDraft = async (repoRoot: string, changeName: string): Promise<boolean> => {
  const draftPath = join(getDraftsDir(repoRoot), `${changeName}.json`);
  const file = Bun.file(draftPath);

  if (!(await file.exists())) {
    return false;
  }

  await unlink(draftPath);
  logger.info("Draft deleted", { path: draftPath });
  return true;
};
