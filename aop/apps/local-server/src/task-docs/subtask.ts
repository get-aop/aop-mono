import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import type { SubtaskDoc, SubtaskDocFrontmatter } from "./types.ts";

const SUBTASK_FILE_RE = /^\d{3}-.*\.md$/;

export const listSubtaskDocs = async (taskDir: string): Promise<SubtaskDoc[]> => {
  const entries = readdirSync(taskDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SUBTASK_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const subtasks: SubtaskDoc[] = [];

  for (const filename of entries) {
    const markdown = await Bun.file(join(taskDir, filename)).text();
    const { frontmatter } = parseFrontmatter<SubtaskDocFrontmatter>(markdown);
    subtasks.push({
      filename,
      status: typeof frontmatter.status === "string" ? frontmatter.status.toUpperCase() : "PENDING",
    });
  }

  return subtasks;
};
