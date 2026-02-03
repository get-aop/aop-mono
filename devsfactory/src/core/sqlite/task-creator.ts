import type { Task } from "../../types";
import { SQLiteTaskStorage } from "./sqlite-task-storage";

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

const formatTimestamp = (date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

const uniqueFolder = async (
  storage: SQLiteTaskStorage,
  base: string
): Promise<string> => {
  const existing = await storage.listTaskFolders();
  if (!existing.includes(base)) return base;

  let counter = 2;
  while (existing.includes(`${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
};

export const createSimpleTask = async (input: {
  projectName: string;
  description: string;
}): Promise<{ taskFolder: string; taskId: number | null }> => {
  const storage = new SQLiteTaskStorage({ projectName: input.projectName });
  const baseSlug = slugify(input.description || "task");
  const baseFolder = `${formatTimestamp()}-${baseSlug || "task"}`;
  const taskFolder = await uniqueFolder(storage, baseFolder);

  const task: Omit<Task, "folder"> = {
    frontmatter: {
      title: input.description.slice(0, 100) || "New Task",
      status: "BACKLOG",
      created: new Date(),
      priority: "medium",
      tags: [],
      assignee: null,
      dependencies: [],
      startedAt: null,
      completedAt: null,
      durationMs: null
    },
    description: input.description,
    requirements: input.description,
    acceptanceCriteria: [],
    notes: undefined
  };

  await storage.createTask(taskFolder, task);

  const taskId = await storage.getTaskId(taskFolder);
  return { taskFolder, taskId };
};
