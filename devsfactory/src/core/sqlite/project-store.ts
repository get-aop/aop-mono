import { dirname, resolve } from "node:path";
import { getDatabase } from "./database";

export interface ProjectRecord {
  name: string;
  path: string;
  gitRemote?: string | null;
  registeredAt: Date;
}

const nowIso = () => new Date().toISOString();

export const getProjectByName = (name: string): ProjectRecord | null => {
  const db = getDatabase();
  const row = db.queryOne<{
    name: string;
    path: string;
    git_remote: string | null;
    registered_at: string;
  }>(
    "SELECT name, path, git_remote, registered_at FROM projects WHERE name = ?",
    [name]
  );

  if (!row) return null;

  return {
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    registeredAt: new Date(row.registered_at)
  };
};

export const listProjects = (): ProjectRecord[] => {
  const db = getDatabase();
  const rows = db.query<{
    name: string;
    path: string;
    git_remote: string | null;
    registered_at: string;
  }>(
    "SELECT name, path, git_remote, registered_at FROM projects ORDER BY name"
  );

  return rows.map((row) => ({
    name: row.name,
    path: row.path,
    gitRemote: row.git_remote,
    registeredAt: new Date(row.registered_at)
  }));
};

export const findProjectByPath = async (
  searchPath: string
): Promise<ProjectRecord | null> => {
  const projects = listProjects();
  if (projects.length === 0) {
    return null;
  }

  const currentPath = resolve(searchPath);

  for (const project of projects) {
    const projectPath = resolve(project.path);
    if (
      currentPath === projectPath ||
      currentPath.startsWith(`${projectPath}/`)
    ) {
      return project;
    }
  }

  return null;
};

export const registerProject = (input: {
  name: string;
  path: string;
  gitRemote?: string | null;
}): ProjectRecord => {
  const db = getDatabase();

  const existing = db.queryOne<{ name: string }>(
    "SELECT name FROM projects WHERE name = ? OR path = ?",
    [input.name, input.path]
  );
  if (existing) {
    throw new Error(`Project '${input.name}' is already registered`);
  }

  const now = nowIso();
  db.run(
    `INSERT INTO projects (name, path, git_remote, registered_at)
     VALUES (?, ?, ?, ?)`,
    [input.name, input.path, input.gitRemote ?? null, now]
  );

  return {
    name: input.name,
    path: input.path,
    gitRemote: input.gitRemote ?? null,
    registeredAt: new Date(now)
  };
};

export const unregisterProject = (name: string): void => {
  const db = getDatabase();

  const existing = db.queryOne<{ name: string }>(
    "SELECT name FROM projects WHERE name = ?",
    [name]
  );
  if (!existing) {
    throw new Error(`Project '${name}' not found`);
  }

  db.run("DELETE FROM projects WHERE name = ?", [name]);
};

export const ensureProjectRecord = (input: {
  name: string;
  path: string;
  gitRemote?: string | null;
}): void => {
  const db = getDatabase();

  // Check if project exists by exact name
  const existingByName = db.queryOne<{ name: string; path: string }>(
    "SELECT name, path FROM projects WHERE name = ?",
    [input.name]
  );
  if (existingByName) return;

  // Check if project exists by path (might have different name)
  const existingByPath = db.queryOne<{ name: string }>(
    "SELECT name FROM projects WHERE path = ?",
    [input.path]
  );

  if (existingByPath) {
    // Project exists with same path but different name - update the name
    db.run("UPDATE projects SET name = ? WHERE path = ?", [
      input.name,
      input.path
    ]);
    return;
  }

  // No existing project - insert new one
  db.run(
    `INSERT INTO projects (name, path, git_remote, registered_at)
     VALUES (?, ?, ?, ?)`,
    [input.name, input.path, input.gitRemote ?? null, nowIso()]
  );
};

export const ensureProjectFromDevsfactoryDir = (input: {
  name: string;
  devsfactoryDir: string;
  gitRemote?: string | null;
}): void => {
  const projectPath = resolve(dirname(input.devsfactoryDir));
  ensureProjectRecord({
    name: input.name,
    path: projectPath,
    gitRemote: input.gitRemote
  });
};
