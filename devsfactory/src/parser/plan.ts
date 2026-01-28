import { ZodError } from "zod";
import { ParseError } from "../errors";
import type { Plan, PlanFrontmatter, SubtaskReference } from "../types";
import { PlanFrontmatterSchema } from "../types";
import { parseFrontmatter } from "./frontmatter";

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

  let frontmatter: PlanFrontmatter;
  let body: string;
  try {
    const parsed = parseFrontmatter(content, PlanFrontmatterSchema);
    frontmatter = parsed.frontmatter;
    body = parsed.content;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ParseError(filePath, error);
    }
    throw error;
  }

  const subtasks = parseSubtaskList(body);

  return {
    folder: taskFolder,
    frontmatter,
    subtasks
  };
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
