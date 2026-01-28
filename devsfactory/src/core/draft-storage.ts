import { join } from "node:path";
import { type BrainstormDraft, BrainstormDraftSchema } from "../types";

const DRAFTS_SUBDIR = ".drafts";
const DEFAULT_MAX_AGE_DAYS = 7;
const DEFAULT_DEVSFACTORY_DIR = ".devsfactory";

const getDraftsDir = (devsfactoryDir: string): string =>
  join(devsfactoryDir, DRAFTS_SUBDIR);

const getDraftPath = (sessionId: string, devsfactoryDir: string): string =>
  join(getDraftsDir(devsfactoryDir), `${sessionId}.json`);

export const saveDraft = async (
  draft: BrainstormDraft,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const draftsDir = getDraftsDir(devsfactoryDir);
  const draftPath = getDraftPath(draft.sessionId, devsfactoryDir);
  const tempPath = `${draftPath}.tmp`;

  await Bun.$`mkdir -p ${draftsDir}`.quiet();

  const content = JSON.stringify(draft, null, 2);
  await Bun.write(tempPath, content);
  await Bun.$`mv ${tempPath} ${draftPath}`.quiet();
};

export const loadDraft = async (
  sessionId: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<BrainstormDraft | null> => {
  const draftPath = getDraftPath(sessionId, devsfactoryDir);
  const file = Bun.file(draftPath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    const validated = BrainstormDraftSchema.safeParse(parsed);

    if (!validated.success) {
      console.warn(
        `Invalid draft schema for ${sessionId}:`,
        validated.error.message
      );
      return null;
    }

    return validated.data;
  } catch (error) {
    console.warn(`Failed to load draft ${sessionId}:`, error);
    return null;
  }
};

export const listDrafts = async (
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<BrainstormDraft[]> => {
  const draftsDir = getDraftsDir(devsfactoryDir);

  try {
    const glob = new Bun.Glob("*.json");
    const files = await Array.fromAsync(glob.scan({ cwd: draftsDir }));

    const drafts: BrainstormDraft[] = [];

    for (const filename of files) {
      const sessionId = filename.replace(".json", "");
      const draft = await loadDraft(sessionId, devsfactoryDir);
      if (draft) {
        drafts.push(draft);
      }
    }

    return drafts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  } catch {
    return [];
  }
};

export const deleteDraft = async (
  sessionId: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const draftPath = getDraftPath(sessionId, devsfactoryDir);
  await Bun.$`rm -f ${draftPath}`.quiet();
};

export const cleanupOldDrafts = async (
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR,
  maxAgeDays = DEFAULT_MAX_AGE_DAYS
): Promise<number> => {
  const drafts = await listDrafts(devsfactoryDir);
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  let deletedCount = 0;

  for (const draft of drafts) {
    if (draft.updatedAt < cutoff) {
      await deleteDraft(draft.sessionId, devsfactoryDir);
      deletedCount++;
    }
  }

  return deletedCount;
};
