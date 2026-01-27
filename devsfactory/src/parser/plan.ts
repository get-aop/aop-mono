import type { Plan, PlanStatus, SubtaskReference } from "../types";
import { PlanFrontmatterSchema } from "../types";
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter
} from "./frontmatter";

const DEFAULT_DEVSFACTORY_DIR = ".devsfactory";

export const parsePlan = async (
  taskFolder: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<Plan | null> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/plan.md`;
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const { frontmatter, content: body } = parseFrontmatter(
    content,
    PlanFrontmatterSchema
  );

  const subtasks = parseSubtaskList(body);

  return {
    folder: taskFolder,
    frontmatter,
    subtasks
  };
};

export const createPlan = async (
  taskFolder: string,
  plan: Omit<Plan, "folder">,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/plan.md`;

  const body = serializePlanBody(plan.subtasks);
  const markdown = serializeFrontmatter({
    frontmatter: plan.frontmatter as Record<string, unknown>,
    content: body
  });

  await Bun.write(filePath, markdown);
};

export const updatePlanStatus = async (
  taskFolder: string,
  status: PlanStatus,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/plan.md`;

  await updateFrontmatter(filePath, PlanFrontmatterSchema, (current) => ({
    ...current,
    status
  }));
};

export const addSubtaskToPlan = async (
  taskFolder: string,
  subtask: SubtaskReference,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const plan = await parsePlan(taskFolder, devsfactoryDir);

  if (!plan) {
    throw new Error(`Plan not found: ${taskFolder}`);
  }

  plan.subtasks.push(subtask);

  await createPlan(taskFolder, plan, devsfactoryDir);
};

export const appendPlanBlockers = async (
  taskFolder: string,
  blockerMessage: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/plan.md`;
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Plan not found: ${taskFolder}`);
  }

  const content = await file.text();
  const blockerEntry = formatBlockerEntry(blockerMessage);
  const newContent = insertBlockerEntry(content, blockerEntry);

  await Bun.write(filePath, newContent);
};

const formatBlockerEntry = (message: string): string => {
  const timestamp = new Date().toISOString();
  return `- [${timestamp}] ${message}`;
};

const BLOCKERS_HEADER = "### Blockers";
const BLOCKERS_PLACEHOLDER =
  "(filled when agent gets stuck or needs user input)";

const insertBlockerEntry = (content: string, blockerEntry: string): string => {
  const headerIndex = content.indexOf(BLOCKERS_HEADER);

  if (headerIndex === -1) {
    return `${content}\n${BLOCKERS_HEADER}\n\n${blockerEntry}\n`;
  }

  const beforeBlockers = content.slice(0, headerIndex + BLOCKERS_HEADER.length);
  const afterBlockers = content
    .slice(headerIndex + BLOCKERS_HEADER.length)
    .replace(BLOCKERS_PLACEHOLDER, "")
    .trim();

  const suffix = afterBlockers ? `\n${afterBlockers}` : "";
  return `${beforeBlockers}\n\n${blockerEntry}${suffix}\n`;
};

const SUBTASK_REGEX =
  /^(\d+)\.\s+(\d{3})-([a-z0-9-]+)\s+\(([^)]+)\)(?:\s+→\s+depends on:\s+(.+))?$/;

const parseSubtaskList = (body: string): SubtaskReference[] => {
  const subtasksSection = extractSubtasksSection(body);
  if (!subtasksSection) {
    return [];
  }

  const subtasks: SubtaskReference[] = [];
  for (const line of subtasksSection.split("\n")) {
    const match = line.trim().match(SUBTASK_REGEX);
    if (match) {
      subtasks.push({
        number: Number.parseInt(match[2]!, 10),
        slug: match[3]!,
        title: match[4]!,
        dependencies: parseDependencies(match[5])
      });
    }
  }
  return subtasks;
};

const extractSubtasksSection = (body: string): string | null => {
  const lines = body.split("\n");
  let inSubtasks = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (line.match(/^##\s+Subtasks$/i)) {
      inSubtasks = true;
      continue;
    }
    if (inSubtasks && line.match(/^##\s+/)) {
      break;
    }
    if (inSubtasks) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join("\n").trim() || null;
};

const parseDependencies = (deps: string | undefined): number[] => {
  if (!deps) {
    return [];
  }
  return deps
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .map((d) => Number.parseInt(d, 10));
};

const serializeSubtaskLine = (subtask: SubtaskReference): string => {
  const paddedNum = subtask.number.toString().padStart(3, "0");
  const base = `${subtask.number}. ${paddedNum}-${subtask.slug} (${subtask.title})`;

  if (subtask.dependencies.length === 0) {
    return base;
  }

  const deps = subtask.dependencies
    .map((d) => d.toString().padStart(3, "0"))
    .join(", ");
  return `${base} → depends on: ${deps}`;
};

const serializePlanBody = (subtasks: SubtaskReference[]): string => {
  const subtaskLines = subtasks.map(serializeSubtaskLine);

  const sections = [
    "\n## Subtasks",
    ...subtaskLines,
    "",
    "## Result",
    "",
    "(filled after all subtasks complete)",
    "",
    "## Review Attempts",
    "",
    "### Review Attempt 1",
    "",
    "(to be filled by the Reviewer Agent)",
    "",
    "### Review Attempt 2",
    "",
    "(to be filled by the Reviewer Agent)",
    "",
    "### Review Attempt 3",
    "",
    "(to be filled by the Reviewer Agent)",
    "",
    "### Blockers",
    "",
    "(filled when agent gets stuck or needs user input)",
    ""
  ];

  return sections.join("\n");
};
