import { readdir, realpath, rm, statfs } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import YAML from "yaml";
import type { ProjectConfig } from "../types";
import { getGlobalDir } from "./global-bootstrap";

export const extractProjectNameFromRemote = (remoteUrl: string): string => {
  let path: string;

  if (remoteUrl.startsWith("git@")) {
    const colonIndex = remoteUrl.indexOf(":");
    path = remoteUrl.slice(colonIndex + 1);
  } else {
    const url = new URL(remoteUrl);
    path = url.pathname.slice(1);
  }

  if (path.endsWith(".git")) {
    path = path.slice(0, -4);
  }

  return path.replace(/\//g, "-");
};

const getProjectsDir = (): string => join(getGlobalDir(), "projects");

const getGitRoot = async (path: string): Promise<string | null> => {
  try {
    const result =
      await Bun.$`git -C ${path} rev-parse --show-toplevel`.quiet();
    return result.text().trim();
  } catch {
    return null;
  }
};

const getOriginRemote = async (path: string): Promise<string | null> => {
  try {
    const result = await Bun.$`git -C ${path} remote get-url origin`.quiet();
    return result.text().trim();
  } catch {
    return null;
  }
};

const checkFilesystemCompatibility = async (
  repoPath: string,
  worktreesDir: string
): Promise<boolean> => {
  try {
    const repoStat = await statfs(repoPath);
    const worktreesStat = await statfs(worktreesDir);
    return repoStat.type === worktreesStat.type;
  } catch {
    return true;
  }
};

export const registerProject = async (path: string): Promise<ProjectConfig> => {
  const resolvedPath = await realpath(resolve(path));
  const gitRoot = await getGitRoot(resolvedPath);

  if (!gitRoot) {
    throw new Error(`Path '${path}' is not inside a git repository`);
  }

  const remote = await getOriginRemote(gitRoot);
  const projectName = remote
    ? extractProjectNameFromRemote(remote)
    : basename(gitRoot);

  const projectsDir = getProjectsDir();
  const projectFile = join(projectsDir, `${projectName}.yaml`);

  if (await Bun.file(projectFile).exists()) {
    throw new Error(`Project '${projectName}' is already registered`);
  }

  const worktreesDir = join(getGlobalDir(), "worktrees");
  const filesystemsCompatible = await checkFilesystemCompatibility(
    gitRoot,
    worktreesDir
  );

  if (!filesystemsCompatible) {
    throw new Error(
      `Filesystem incompatibility: '${gitRoot}' and '${worktreesDir}' are on different filesystem types. ` +
        `Git worktrees may not work correctly across different filesystems.`
    );
  }

  const config: ProjectConfig = {
    name: projectName,
    path: gitRoot,
    gitRemote: remote,
    registered: new Date()
  };

  await Bun.write(projectFile, YAML.stringify(config));

  return config;
};

export const unregisterProject = async (name: string): Promise<void> => {
  const projectFile = join(getProjectsDir(), `${name}.yaml`);

  if (!(await Bun.file(projectFile).exists())) {
    throw new Error(`Project '${name}' not found`);
  }

  await rm(projectFile);
};

export const listProjects = async (): Promise<ProjectConfig[]> => {
  const projectsDir = getProjectsDir();
  let entries: string[];

  try {
    entries = await readdir(projectsDir);
  } catch {
    return [];
  }

  const yamlFiles = entries.filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml")
  );

  const projects: ProjectConfig[] = [];

  for (const file of yamlFiles) {
    const filePath = join(projectsDir, file);
    const content = await Bun.file(filePath).text();
    const parsed = YAML.parse(content) as ProjectConfig;
    parsed.registered = new Date(parsed.registered);
    projects.push(parsed);
  }

  return projects;
};

export const getProject = async (
  name: string
): Promise<ProjectConfig | null> => {
  const projectFile = join(getProjectsDir(), `${name}.yaml`);

  if (!(await Bun.file(projectFile).exists())) {
    return null;
  }

  const content = await Bun.file(projectFile).text();
  const parsed = YAML.parse(content) as ProjectConfig;
  parsed.registered = new Date(parsed.registered);
  return parsed;
};

export const findProjectByPath = async (
  searchPath: string
): Promise<ProjectConfig | null> => {
  const projects = await listProjects();
  if (projects.length === 0) {
    return null;
  }

  let currentPath: string;
  try {
    currentPath = await realpath(resolve(searchPath));
  } catch {
    currentPath = resolve(searchPath);
  }

  for (const project of projects) {
    let projectPath: string;
    try {
      projectPath = await realpath(project.path);
    } catch {
      projectPath = project.path;
    }

    if (
      currentPath === projectPath ||
      currentPath.startsWith(`${projectPath}/`)
    ) {
      return project;
    }
  }

  return null;
};
