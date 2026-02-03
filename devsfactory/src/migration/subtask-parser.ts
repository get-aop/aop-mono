/**
 * @deprecated Migration-only module for parsing subtask md files from legacy filesystem storage.
 * Used by the `aop migrate` command and transitional sync code.
 * Do not use for new code - all new subtask data should be read from SQLiteTaskStorage.
 */

import { ZodError } from "zod";
import { ParseError } from "../errors";
import type { Subtask, SubtaskFrontmatter } from "../types";
import { SubtaskFrontmatterSchema } from "../types";
import { parseFrontmatter } from "./frontmatter";

const DEFAULT_DEVSFACTORY_DIR = ".devsfactory";
const SUBTASK_FILENAME_REGEX = /^(\d{3})-(.+)\.md$/;

export const parseSubtask = async (
  taskFolder: string,
  filename: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<Subtask> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/${filename}`;
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    throw new Error(`Subtask file not found: ${filePath}`);
  }

  const content = await file.text();

  let frontmatter: SubtaskFrontmatter;
  let body: string;
  try {
    const parsed = parseFrontmatter(content, SubtaskFrontmatterSchema);
    frontmatter = parsed.frontmatter;
    body = parsed.content;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ParseError(filePath, error);
    }
    throw error;
  }

  const { number, slug } = parseFilename(filename);
  const sections = extractSections(body);

  return {
    filename,
    number,
    slug,
    frontmatter,
    description: sections.description,
    context: sections.context,
    result: sections.result,
    review: sections.review,
    blockers: sections.blockers
  };
};

export const listSubtasks = async (
  taskFolder: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<Subtask[]> => {
  const dirPath = `${devsfactoryDir}/${taskFolder}`;

  try {
    const glob = new Bun.Glob("[0-9][0-9][0-9]-*.md");
    const matches = await Array.fromAsync(glob.scan({ cwd: dirPath }));

    const subtaskFiles = matches.filter(
      (f) => !f.endsWith("-review.md") && SUBTASK_FILENAME_REGEX.test(f)
    );

    const subtasks = await Promise.all(
      subtaskFiles.map((f) => parseSubtask(taskFolder, f, devsfactoryDir))
    );

    return subtasks.sort((a, b) => a.number - b.number);
  } catch {
    return [];
  }
};

export const getReadySubtasks = async (
  taskFolder: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<Subtask[]> => {
  const allSubtasks = await listSubtasks(taskFolder, devsfactoryDir);

  const doneNumbers = new Set(
    allSubtasks
      .filter((s) => s.frontmatter.status === "DONE")
      .map((s) => s.number)
  );

  return allSubtasks.filter(
    (subtask) =>
      subtask.frontmatter.status === "PENDING" &&
      subtask.frontmatter.dependencies.every((dep) => doneNumbers.has(dep))
  );
};

const parseFilename = (filename: string): { number: number; slug: string } => {
  const match = filename.match(SUBTASK_FILENAME_REGEX);

  if (!match) {
    throw new Error(`Invalid subtask filename: ${filename}`);
  }

  return {
    number: Number.parseInt(match[1]!, 10),
    slug: match[2]!
  };
};

const extractSections = (
  body: string
): {
  description: string;
  context?: string;
  result?: string;
  review?: string;
  blockers?: string;
} => {
  const sections: Record<string, string> = {};
  const lines = body.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^###\s+(.+)$/);
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

  const toOptional = (value: string | undefined): string | undefined =>
    value || undefined;

  return {
    description: sections.description || "",
    context: toOptional(sections.context),
    result: toOptional(sections.result),
    review: toOptional(sections.review),
    blockers: toOptional(sections.blockers)
  };
};
