import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { BrainstormingResult } from "../create-task/brainstorm-parser.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import type { TaskDocFrontmatter } from "./types.ts";

interface SubtaskSeed {
  title: string;
  description: string;
  dependencies: number[];
}

export interface ScaffoldTaskResult {
  taskName: string;
  taskPath: string;
  createdFiles: string[];
}

const DEFAULT_PRIORITY = "medium";

export const toTaskSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

export const getTaskDocsRoot = (repoRoot: string): string => join(repoRoot, aopPaths.relativeTaskDocs());

export const getTaskDir = (repoRoot: string, taskName: string): string =>
  join(getTaskDocsRoot(repoRoot), taskName);

export const scaffoldTaskFromBrainstorm = async (
  repoRoot: string,
  taskName: string,
  requirements: BrainstormingResult,
): Promise<ScaffoldTaskResult> => {
  const taskSlug = toTaskSlug(taskName) || "task";
  const taskDir = getTaskDir(repoRoot, taskSlug);
  const createdAt = new Date().toISOString();

  await mkdir(taskDir, { recursive: true });

  const subtasks = buildSubtaskSeeds(requirements);
  const createdFiles = [
    await writeTaskFile(taskDir, requirements, createdAt),
    await writePlanFile(taskDir, taskSlug, subtasks, createdAt),
    ...(await writeSubtaskFiles(taskDir, subtasks)),
  ];

  return {
    taskName: taskSlug,
    taskPath: join(aopPaths.relativeTaskDocs(), taskSlug),
    createdFiles,
  };
};

const buildSubtaskSeeds = (requirements: BrainstormingResult): SubtaskSeed[] => {
  const items = requirements.requirements.length > 0 ? requirements.requirements : requirements.acceptanceCriteria;

  if (items.length === 0) {
    return [
      {
        title: requirements.title,
        description: requirements.description,
        dependencies: [],
      },
    ];
  }

  return items.map((item, index) => ({
    title: item,
    description: item,
    dependencies: index === 0 ? [] : [index],
  }));
};

const writeTaskFile = async (
  taskDir: string,
  requirements: BrainstormingResult,
  createdAt: string,
): Promise<string> => {
  const filePath = join(taskDir, "task.md");
  const frontmatter: TaskDocFrontmatter = {
    title: requirements.title,
    status: TaskStatus.DRAFT,
    created: createdAt,
    priority: DEFAULT_PRIORITY,
    tags: [],
    assignee: null,
    dependencies: [],
    branch: undefined,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };

  const body = [
    "",
    "## Description",
    requirements.description,
    "",
    "## Requirements",
    ...formatBulletList(requirements.requirements),
    "",
    "## Acceptance Criteria",
    ...formatCheckboxList(requirements.acceptanceCriteria),
    "",
  ].join("\n");

  await Bun.write(
    filePath,
    serializeFrontmatter({
      frontmatter,
      content: body,
    }),
  );

  return filePath;
};

const writePlanFile = async (
  taskDir: string,
  taskSlug: string,
  subtasks: SubtaskSeed[],
  createdAt: string,
): Promise<string> => {
  const filePath = join(taskDir, "plan.md");
  const body = [
    "",
    "## Subtasks",
    ...subtasks.map((subtask, index) => {
      const number = index + 1;
      const slug = toTaskSlug(subtask.title) || `task-${number}`;
      const deps =
        subtask.dependencies.length > 0
          ? ` -> depends on: ${subtask.dependencies.join(", ")}`
          : "";
      return `${number}. ${number.toString().padStart(3, "0")}-${slug} (${subtask.title})${deps}`;
    }),
    "",
  ].join("\n");

  await Bun.write(
    filePath,
    serializeFrontmatter({
      frontmatter: {
        status: "INPROGRESS",
        task: taskSlug,
        created: createdAt,
      },
      content: body,
    }),
  );

  return filePath;
};

const writeSubtaskFiles = async (taskDir: string, subtasks: SubtaskSeed[]): Promise<string[]> => {
  const createdFiles: string[] = [];

  for (const [index, subtask] of subtasks.entries()) {
    const number = index + 1;
    const slug = toTaskSlug(subtask.title) || `task-${number}`;
    const filePath = join(taskDir, `${number.toString().padStart(3, "0")}-${slug}.md`);
    const body = [
      "",
      "### Description",
      subtask.description,
      "",
      "### Context",
      "",
      "### Result",
      "",
      "### Review",
      "",
      "### Blockers",
      "",
    ].join("\n");

    await Bun.write(
      filePath,
      serializeFrontmatter({
        frontmatter: {
          title: subtask.title,
          status: "PENDING",
          dependencies: subtask.dependencies,
        },
        content: body,
      }),
    );

    createdFiles.push(filePath);
  }

  return createdFiles;
};

const formatBulletList = (items: string[]): string[] => {
  if (items.length === 0) return ["- None recorded"];
  return items.map((item) => `- ${item}`);
};

const formatCheckboxList = (items: string[]): string[] => {
  if (items.length === 0) return ["- [ ] Define acceptance criteria"];
  return items.map((item) => `- [ ] ${item}`);
};
