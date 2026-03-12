import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { BrainstormingResult } from "../create-task/brainstorm-parser.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import { parseTaskDoc } from "./task.ts";
import type { TaskDocFrontmatter } from "./types.ts";

interface SubtaskSeed {
  title: string;
  description: string;
  dependencies: number[];
}

const CHECKBOX_ITEM_REGEX = /^-\s+\[[ xX]\]\s+(.+)$/;
const BULLET_ITEM_REGEX = /^-\s+(.+)$/;

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

export const getTaskDocsRoot = (repoRoot: string): string =>
  join(repoRoot, aopPaths.relativeTaskDocs());

export const getTaskDir = (repoRoot: string, taskName: string): string =>
  join(getTaskDocsRoot(repoRoot), taskName);

export const ensureExecutionPlanArtifacts = async (taskDir: string): Promise<string[]> => {
  const planPath = join(taskDir, "plan.md");
  const existingSubtaskFiles = listSubtaskFiles(taskDir);

  if (existsSync(planPath) && existingSubtaskFiles.length > 0) {
    return [];
  }

  const taskDoc = await parseTaskDoc(join(taskDir, "task.md"));
  const subtasks = await buildLegacySubtaskSeeds(taskDir, taskDoc);
  if (subtasks.length === 0) {
    return [];
  }

  const taskSlug = basename(taskDir);
  const createdFiles: string[] = [];

  if (!existsSync(planPath)) {
    createdFiles.push(await writePlanFile(taskDir, taskSlug, subtasks, taskDoc.createdAt));
  }

  if (existingSubtaskFiles.length === 0) {
    createdFiles.push(...(await writeSubtaskFiles(taskDir, subtasks)));
  }

  return createdFiles;
};

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
  const items =
    requirements.requirements.length > 0
      ? requirements.requirements
      : requirements.acceptanceCriteria;

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

const listSubtaskFiles = (taskDir: string): string[] => {
  try {
    return readdirSync(taskDir).filter((file) => /^\d{3}-.*\.md$/.test(file));
  } catch {
    return [];
  }
};

const buildLegacySubtaskSeeds = async (
  taskDir: string,
  taskDoc: Awaited<ReturnType<typeof parseTaskDoc>>,
): Promise<SubtaskSeed[]> => {
  const tasksChecklistPath = join(taskDir, "tasks.md");
  const checklistItems = existsSync(tasksChecklistPath)
    ? parseChecklistItems(await Bun.file(tasksChecklistPath).text())
    : [];
  const candidateItems =
    checklistItems.length > 0
      ? checklistItems
      : [
          ...taskDoc.acceptanceCriteria.map((criterion) => criterion.text),
          ...parseBulletList(taskDoc.requirements),
        ];

  const uniqueItems = [...new Set(candidateItems.map((item) => item.trim()).filter(Boolean))];
  if (uniqueItems.length > 0) {
    return uniqueItems.map((item, index) => ({
      title: item,
      description: item,
      dependencies: index === 0 ? [] : [index],
    }));
  }

  return [
    {
      title: taskDoc.title,
      description: taskDoc.description || taskDoc.title,
      dependencies: [],
    },
  ];
};

const parseChecklistItems = (content: string): string[] =>
  content.split("\n").flatMap((line) => {
    const match = line.match(CHECKBOX_ITEM_REGEX);
    return match?.[1] ? [match[1].trim()] : [];
  });

const parseBulletList = (content: string): string[] =>
  content.split("\n").flatMap((line) => {
    const match = line.match(BULLET_ITEM_REGEX);
    return match?.[1] ? [match[1].trim()] : [];
  });

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
        subtask.dependencies.length > 0 ? ` -> depends on: ${subtask.dependencies.join(", ")}` : "";
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
