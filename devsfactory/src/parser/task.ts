import { ZodError } from "zod";
import { ParseError } from "../errors";
import type { Task, TaskFrontmatter, TaskStatus } from "../types";
import { TaskFrontmatterSchema } from "../types";
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter
} from "./frontmatter";

const DEFAULT_DEVSFACTORY_DIR = ".devsfactory";

export const parseTask = async (
  taskFolder: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<Task> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/task.md`;
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Task file not found: ${filePath}`);
  }

  const content = await file.text();

  let frontmatter: TaskFrontmatter;
  let body: string;
  try {
    const parsed = parseFrontmatter(content, TaskFrontmatterSchema);
    frontmatter = parsed.frontmatter;
    body = parsed.content;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ParseError(filePath, error);
    }
    throw error;
  }

  const sections = extractSections(body);

  return {
    folder: taskFolder,
    frontmatter,
    description: sections.description,
    requirements: sections.requirements,
    acceptanceCriteria: parseAcceptanceCriteria(sections.acceptanceCriteria),
    notes: sections.notes
  };
};

export const createTask = async (
  taskFolder: string,
  task: Omit<Task, "folder">,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const dirPath = `${devsfactoryDir}/${taskFolder}`;
  const filePath = `${dirPath}/task.md`;

  await Bun.$`mkdir -p ${dirPath}`.quiet();

  const body = serializeTaskBody(task);
  const markdown = serializeFrontmatter({
    frontmatter: task.frontmatter as Record<string, unknown>,
    content: body
  });

  await Bun.write(filePath, markdown);
};

export const updateTaskStatus = async (
  taskFolder: string,
  status: TaskStatus,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/task.md`;

  await updateFrontmatter(filePath, TaskFrontmatterSchema, (current) => ({
    ...current,
    status
  }));
};

export const updateTaskTiming = async (
  taskFolder: string,
  timingUpdate: { startedAt?: Date; completedAt?: Date; durationMs?: number },
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/task.md`;

  const definedUpdates = Object.fromEntries(
    Object.entries(timingUpdate).filter(([, v]) => v !== undefined)
  );

  await updateFrontmatter(filePath, TaskFrontmatterSchema, (current) => ({
    ...current,
    ...definedUpdates
  }));
};

export const listTaskFolders = async (
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<string[]> => {
  try {
    const glob = new Bun.Glob("*/task.md");
    const matches = await Array.fromAsync(glob.scan({ cwd: devsfactoryDir }));
    return matches.map((m) => m.replace("/task.md", "")).sort();
  } catch {
    return [];
  }
};

const extractSections = (
  body: string
): {
  description: string;
  requirements: string;
  acceptanceCriteria: string;
  notes?: string;
} => {
  const sections: Record<string, string> = {};
  const lines = body.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = headerMatch[1]!.toLowerCase().replace(/\s+/g, "_");
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections[currentSection] = currentContent.join("\n").trim();
  }

  return {
    description: sections.description || "",
    requirements: sections.requirements || "",
    acceptanceCriteria: sections.acceptance_criteria || "",
    notes: sections.notes || undefined
  };
};

const CHECKBOX_REGEX = /^-\s+\[([ xX])\]\s+(.+)$/;

const parseAcceptanceCriteria = (
  content: string
): Array<{ text: string; checked: boolean }> =>
  content
    .split("\n")
    .map((line) => line.match(CHECKBOX_REGEX))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      text: match[2]!.trim(),
      checked: match[1]!.toLowerCase() === "x"
    }));

const serializeTaskBody = (task: Omit<Task, "folder">): string => {
  const parts: string[] = [];

  parts.push(`\n## Description\n${task.description}`);
  parts.push(`\n## Requirements\n${task.requirements}`);

  const acLines = task.acceptanceCriteria
    .map((ac) => `- [${ac.checked ? "x" : " "}] ${ac.text}`)
    .join("\n");
  parts.push(`\n## Acceptance Criteria\n${acLines}`);

  if (task.notes !== undefined) {
    parts.push(`\n## Notes\n${task.notes}`);
  }

  return parts.join("\n");
};
