import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
} from "./frontmatter";
import { SubtaskFrontmatterSchema } from "../types";
import type { Subtask, SubtaskStatus } from "../types";

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
  const { frontmatter, content: body } = parseFrontmatter(
    content,
    SubtaskFrontmatterSchema
  );

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
    blockers: sections.blockers,
  };
};

export const createSubtask = async (
  taskFolder: string,
  subtask: Omit<Subtask, "filename" | "number" | "slug">,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<string> => {
  const nextNumber = await getNextSubtaskNumber(taskFolder, devsfactoryDir);
  const slug = slugify(subtask.frontmatter.title);
  const filename = `${nextNumber.toString().padStart(3, "0")}-${slug}.md`;
  const filePath = `${devsfactoryDir}/${taskFolder}/${filename}`;

  const body = serializeSubtaskBody(subtask);
  const markdown = serializeFrontmatter({
    frontmatter: subtask.frontmatter as Record<string, unknown>,
    content: body,
  });

  await Bun.write(filePath, markdown);

  return filename;
};

export const updateSubtaskStatus = async (
  taskFolder: string,
  filename: string,
  status: SubtaskStatus,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const filePath = `${devsfactoryDir}/${taskFolder}/${filename}`;

  await updateFrontmatter(filePath, SubtaskFrontmatterSchema, (current) => ({
    ...current,
    status,
  }));
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

export const appendReviewHistory = async (
  taskFolder: string,
  subtaskFilename: string,
  reviewContent: string,
  devsfactoryDir = DEFAULT_DEVSFACTORY_DIR
): Promise<void> => {
  const reviewFilename = subtaskFilename.replace(/\.md$/, "-review.md");
  const filePath = `${devsfactoryDir}/${taskFolder}/${reviewFilename}`;
  const file = Bun.file(filePath);

  const timestamp = new Date().toISOString();
  let existingContent = "";
  let reviewNumber = 1;

  if (await file.exists()) {
    existingContent = await file.text();
    const matches = existingContent.match(/## Review #(\d+)/g) || [];
    reviewNumber = matches.length + 1;
  }

  const newEntry = `## Review #${reviewNumber} - ${timestamp}\n${reviewContent}\n`;
  const newContent = existingContent
    ? `${existingContent}\n${newEntry}`
    : newEntry;

  await Bun.write(filePath, newContent);
};

const parseFilename = (filename: string): { number: number; slug: string } => {
  const match = filename.match(SUBTASK_FILENAME_REGEX);

  if (!match) {
    throw new Error(`Invalid subtask filename: ${filename}`);
  }

  return {
    number: parseInt(match[1]!, 10),
    slug: match[2]!,
  };
};

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const getNextSubtaskNumber = async (
  taskFolder: string,
  devsfactoryDir: string
): Promise<number> => {
  const subtasks = await listSubtasks(taskFolder, devsfactoryDir);

  if (subtasks.length === 0) {
    return 1;
  }

  const maxNumber = Math.max(...subtasks.map((s) => s.number));
  return maxNumber + 1;
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
    description: sections["description"] || "",
    context: toOptional(sections["context"]),
    result: toOptional(sections["result"]),
    review: toOptional(sections["review"]),
    blockers: toOptional(sections["blockers"]),
  };
};

const serializeSubtaskBody = (
  subtask: Omit<Subtask, "filename" | "number" | "slug">
): string => {
  const parts: string[] = [];

  parts.push(`\n### Description\n${subtask.description}`);

  if (subtask.context !== undefined) {
    parts.push(`\n### Context\n${subtask.context}`);
  }

  if (subtask.result !== undefined) {
    parts.push(`\n### Result\n${subtask.result}`);
  }

  if (subtask.review !== undefined) {
    parts.push(`\n### Review\n${subtask.review}`);
  }

  if (subtask.blockers !== undefined) {
    parts.push(`\n### Blockers\n${subtask.blockers}`);
  }

  return parts.join("\n");
};
