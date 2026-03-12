import { statSync } from "node:fs";
import { basename } from "node:path";
import { TaskStatus } from "@aop/common";
import { parseFrontmatter, serializeFrontmatter, updateFrontmatter } from "./frontmatter.ts";
import type {
  TaskDependencySourceMetadata,
  TaskDoc,
  TaskDocFrontmatter,
  TaskSourceMetadata,
} from "./types.ts";

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

const getSectionKey = (line: string): string | null => {
  const headerMatch = line.match(/^##\s+(.+)$/);
  const title = headerMatch?.[1];
  return title ? title.toLowerCase().replace(/\s+/g, "_") : null;
};

const saveSection = (
  sections: Record<string, string>,
  section: string,
  content: string[],
): void => {
  if (!section) return;
  sections[section] = content.join("\n").trim();
};

const extractSections = (
  body: string,
): {
  description: string;
  requirements: string;
  acceptanceCriteria: string;
} => {
  const sections: Record<string, string> = {};
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of body.split("\n")) {
    const nextSection = getSectionKey(line);
    if (nextSection) {
      saveSection(sections, currentSection, currentContent);
      currentSection = nextSection;
      currentContent = [];
      continue;
    }

    if (currentSection) {
      currentContent.push(line);
    }
  }

  saveSection(sections, currentSection, currentContent);

  return {
    description: sections.description || "",
    requirements: sections.requirements || "",
    acceptanceCriteria: sections.acceptance_criteria || "",
  };
};

const parseAcceptanceCriteria = (content: string): Array<{ text: string; checked: boolean }> =>
  content.split("\n").flatMap((line) => {
    const match = line.match(CHECKBOX_REGEX);
    if (!match) return [];

    const [, checked = "", text = ""] = match;
    return [{ text: text.trim(), checked: checked.toLowerCase() === "x" }];
  });

const parseTaskSource = (value: unknown): TaskSourceMetadata | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as Partial<TaskSourceMetadata>;
  if (
    source.provider !== "linear" ||
    typeof source.id !== "string" ||
    typeof source.ref !== "string" ||
    typeof source.url !== "string"
  ) {
    return null;
  }

  return {
    provider: source.provider,
    id: source.id,
    ref: source.ref,
    url: source.url,
  };
};

const parseDependencySources = (value: unknown): TaskDependencySourceMetadata[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const dependency = entry as Partial<TaskDependencySourceMetadata>;
    if (
      dependency.provider !== "linear" ||
      typeof dependency.id !== "string" ||
      typeof dependency.ref !== "string"
    ) {
      return [];
    }

    return [
      {
        provider: dependency.provider,
        id: dependency.id,
        ref: dependency.ref,
      },
    ];
  });
};

export const parseTaskDoc = async (taskFilePath: string): Promise<TaskDoc> => {
  const markdown = await Bun.file(taskFilePath).text();
  const { frontmatter, content } = parseFrontmatter<TaskDocFrontmatter>(markdown);
  const sections = extractSections(content);
  const stat = statSync(taskFilePath);

  return {
    id: typeof frontmatter.id === "string" ? frontmatter.id : null,
    title: frontmatter.title || basename(taskFilePath, ".md"),
    status: normalizeTaskStatus(frontmatter.status),
    createdAt: frontmatter.created ?? stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    branch: frontmatter.branch ?? null,
    changePath: typeof frontmatter.changePath === "string" ? frontmatter.changePath : null,
    description: sections.description,
    requirements: sections.requirements,
    acceptanceCriteria: parseAcceptanceCriteria(sections.acceptanceCriteria),
    source: parseTaskSource(frontmatter.source),
    dependencySources: parseDependencySources(frontmatter.dependencySources),
    dependencyImported: frontmatter.dependencyImported === true,
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
