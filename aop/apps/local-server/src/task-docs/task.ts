import { statSync } from "node:fs";
import { basename } from "node:path";
import { TaskStatus } from "@aop/common";
import { parseFrontmatter, serializeFrontmatter, updateFrontmatter } from "./frontmatter.ts";
import type { TaskDoc, TaskDocFrontmatter } from "./types.ts";

const CHECKBOX_REGEX = /^-\s+\[([ xX])\]\s+(.+)$/;

const normalizeTaskStatus = (value: unknown): TaskStatus => {
  const normalized = typeof value === "string" ? value.toUpperCase() : "DRAFT";

  switch (normalized) {
    case TaskStatus.READY:
    case TaskStatus.RESUMING:
    case TaskStatus.WORKING:
    case TaskStatus.PAUSED:
    case TaskStatus.BLOCKED:
    case TaskStatus.DONE:
    case TaskStatus.REMOVED:
    case TaskStatus.DRAFT:
      return normalized;
    case "BACKLOG":
      return TaskStatus.DRAFT;
    case "PENDING":
      return TaskStatus.READY;
    case "INPROGRESS":
      return TaskStatus.WORKING;
    case "REVIEW":
      return TaskStatus.BLOCKED;
    default:
      return TaskStatus.DRAFT;
  }
};

const extractSections = (
  body: string,
): {
  description: string;
  requirements: string;
  acceptanceCriteria: string;
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
      continue;
    }

    if (currentSection) {
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
  };
};

const parseAcceptanceCriteria = (
  content: string,
): Array<{ text: string; checked: boolean }> =>
  content
    .split("\n")
    .map((line) => line.match(CHECKBOX_REGEX))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      text: match[2]!.trim(),
      checked: match[1]!.toLowerCase() === "x",
    }));

export const parseTaskDoc = async (taskFilePath: string): Promise<TaskDoc> => {
  const markdown = await Bun.file(taskFilePath).text();
  const { frontmatter, content } = parseFrontmatter<TaskDocFrontmatter>(markdown);
  const sections = extractSections(content);
  const stat = statSync(taskFilePath);

  return {
    title: frontmatter.title || basename(taskFilePath, ".md"),
    status: normalizeTaskStatus(frontmatter.status),
    createdAt: frontmatter.created ?? stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    branch: frontmatter.branch ?? null,
    description: sections.description,
    requirements: sections.requirements,
    acceptanceCriteria: parseAcceptanceCriteria(sections.acceptanceCriteria),
  };
};

export const updateTaskDocStatus = async (
  taskFilePath: string,
  status: TaskStatus,
): Promise<void> => {
  await updateFrontmatter<TaskDocFrontmatter>(taskFilePath, (current) => ({
    ...current,
    status,
  }));
};

export const writeTaskDoc = async (
  taskFilePath: string,
  frontmatter: TaskDocFrontmatter,
  body: string,
): Promise<void> => {
  await Bun.write(
    taskFilePath,
    serializeFrontmatter({
      frontmatter,
      content: body,
    }),
  );
};
