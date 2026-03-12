import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Context } from "hono";
import type { LocalServerContext } from "../context.ts";
import { getRepoById } from "../repo/handlers.ts";
import { getTaskById } from "./handlers.ts";

const listMdFiles = (dir: string, prefix = ""): string[] => {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...listMdFiles(join(dir, entry.name), relative));
      } else if (entry.name.endsWith(".md")) {
        files.push(relative);
      }
    }
    return files;
  } catch {
    return [];
  }
};

export const isValidMdPath = (filePath: string, changeDir: string): boolean => {
  if (filePath.includes("..") || !filePath.endsWith(".md")) {
    return false;
  }
  const resolved = resolve(changeDir, filePath);
  return resolved.startsWith(changeDir);
};

export const handleListFiles = async (ctx: LocalServerContext, c: Context) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId");
  if (!taskId) return c.json({ error: "Task ID is required" }, 400);

  const repo = await getRepoById(ctx, repoId);
  if (!repo) return c.json({ error: "Repo not found" }, 404);

  const task = await getTaskById(ctx, taskId);
  if (!task || task.repo_id !== repoId) return c.json({ error: "Task not found" }, 404);

  const changeDir = join(repo.path, task.change_path);
  const files = listMdFiles(changeDir);
  return c.json({ files });
};

const extractFilePath = (url: string): string => {
  const pathname = new URL(url).pathname;
  const marker = "/files/";
  const idx = pathname.indexOf(marker);
  return idx >= 0 ? decodeURIComponent(pathname.slice(idx + marker.length)) : "";
};

export const handleReadFile = async (ctx: LocalServerContext, c: Context) => {
  const repoId = c.req.param("repoId") as string;
  const taskId = c.req.param("taskId");
  if (!taskId) return c.json({ error: "Task ID is required" }, 400);
  const filePath = extractFilePath(c.req.url);

  const repo = await getRepoById(ctx, repoId);
  if (!repo) return c.json({ error: "Repo not found" }, 404);

  const task = await getTaskById(ctx, taskId);
  if (!task || task.repo_id !== repoId) return c.json({ error: "Task not found" }, 404);

  const changeDir = join(repo.path, task.change_path);
  if (!isValidMdPath(filePath, changeDir)) {
    return c.json({ error: "Invalid file path" }, 400);
  }

  const fullPath = join(changeDir, filePath);
  try {
    const content = readFileSync(fullPath, "utf-8");
    return c.json({ content });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
};
