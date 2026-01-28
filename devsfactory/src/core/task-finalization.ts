import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import KSUID from "ksuid";
import { serializeFrontmatter } from "../parser/frontmatter";
import type { SubtaskPreview, TaskPreview } from "../types";

export interface TaskCreationResult {
  taskFolder: string;
}

export const createTaskFromBrainstorm = async (
  taskPreview: TaskPreview,
  subtasks: SubtaskPreview[],
  devsfactoryDir: string
): Promise<TaskCreationResult> => {
  const baseSlug = slugify(taskPreview.title);
  const taskFolder = await ensureUniqueFolder(baseSlug, devsfactoryDir);
  const taskDir = join(devsfactoryDir, taskFolder);

  await mkdir(taskDir, { recursive: true });

  await writeTaskMd(taskDir, taskPreview);

  const sortedSubtasks = [...subtasks].sort((a, b) => a.number - b.number);
  for (const subtask of sortedSubtasks) {
    await writeSubtaskMd(taskDir, subtask);
  }

  await writePlanMd(taskDir, taskFolder, sortedSubtasks);

  return { taskFolder };
};

const writeTaskMd = async (
  taskDir: string,
  taskPreview: TaskPreview
): Promise<void> => {
  const frontmatter = {
    title: taskPreview.title,
    status: "PENDING",
    created: new Date().toISOString(),
    priority: "medium",
    tags: [],
    assignee: null,
    dependencies: [],
    startedAt: null,
    completedAt: null,
    durationMs: null
  };

  const acLines = taskPreview.acceptanceCriteria
    .map((ac) => `- [ ] ${ac}`)
    .join("\n");

  const content = `
## Description

${taskPreview.description}

## Requirements

${taskPreview.requirements}

## Acceptance Criteria

${acLines}
`;

  const markdown = serializeFrontmatter({ frontmatter, content });
  await Bun.write(join(taskDir, "task.md"), markdown);
};

const writeSubtaskMd = async (
  taskDir: string,
  subtask: SubtaskPreview
): Promise<void> => {
  const filename = `${subtask.number.toString().padStart(3, "0")}-${subtask.slug}.md`;

  const frontmatter: Record<string, unknown> = {
    title: subtask.title,
    status: "PENDING",
    dependencies: subtask.dependencies
  };

  let content = `
### Description

${subtask.description}
`;

  if (subtask.context) {
    content += `
### Context

${subtask.context}
`;
  }

  content += `
### Result

(filled by agent after completion)

### Review

(filled by review agent)

### Blockers

(filled when agent gets stuck or needs user input)
`;

  const markdown = serializeFrontmatter({ frontmatter, content });
  await Bun.write(join(taskDir, filename), markdown);
};

const writePlanMd = async (
  taskDir: string,
  taskFolder: string,
  subtasks: SubtaskPreview[]
): Promise<void> => {
  const frontmatter = {
    status: "INPROGRESS",
    task: taskFolder,
    created: new Date().toISOString()
  };

  const subtaskLines = subtasks.map((s) => {
    const filename = `${s.number.toString().padStart(3, "0")}-${s.slug}`;
    const depsStr =
      s.dependencies.length > 0
        ? ` → depends on: ${s.dependencies.join(", ")}`
        : "";
    return `${s.number}. ${filename} (${s.title})${depsStr}`;
  });

  const content = `
## Subtasks

${subtaskLines.join("\n")}
`;

  const markdown = serializeFrontmatter({ frontmatter, content });
  await Bun.write(join(taskDir, "plan.md"), markdown);
};

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const ensureUniqueFolder = async (
  baseSlug: string,
  devsfactoryDir: string
): Promise<string> => {
  const basePath = join(devsfactoryDir, baseSlug);
  const exists = await Bun.file(join(basePath, "task.md")).exists();

  if (!exists) {
    const dirExists = await folderExists(basePath);
    if (!dirExists) {
      return baseSlug;
    }
  }

  const suffix = KSUID.randomSync().string.toLowerCase().slice(0, 8);
  return `${baseSlug}-${suffix}`;
};

const folderExists = async (path: string): Promise<boolean> => {
  try {
    const glob = new Bun.Glob("*");
    await Array.fromAsync(glob.scan({ cwd: path }));
    return true;
  } catch {
    return false;
  }
};
