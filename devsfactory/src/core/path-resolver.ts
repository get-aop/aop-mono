import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ResolvedPaths } from "../types";
import { getGlobalDir } from "./global-bootstrap";
import { findProjectByPath, getProject } from "./project-registry";

const directoryExists = async (path: string): Promise<boolean> => {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

export const resolvePaths = async (
  cwd?: string
): Promise<ResolvedPaths | null> => {
  const workingDir = cwd ?? process.cwd();

  const devsfactoryDir = join(workingDir, ".devsfactory");
  const hasLocalDevsfactory = await directoryExists(devsfactoryDir);

  if (hasLocalDevsfactory) {
    return {
      mode: "local",
      projectName: basename(workingDir),
      projectRoot: workingDir,
      devsfactoryDir,
      worktreesDir: join(workingDir, ".worktrees"),
      brainstormDir: join(devsfactoryDir, "brainstorm")
    };
  }

  const project = await findProjectByPath(workingDir);
  if (project) {
    const globalDir = getGlobalDir();
    return {
      mode: "global",
      projectName: project.name,
      projectRoot: project.path,
      devsfactoryDir: join(globalDir, "tasks", project.name),
      worktreesDir: join(globalDir, "worktrees", project.name),
      brainstormDir: join(globalDir, "brainstorm", project.name)
    };
  }

  return null;
};

export const resolvePathsForProject = async (
  projectName: string
): Promise<ResolvedPaths | null> => {
  const project = await getProject(projectName);
  if (!project) {
    return null;
  }

  const globalDir = getGlobalDir();
  return {
    mode: "global",
    projectName: project.name,
    projectRoot: project.path,
    devsfactoryDir: join(globalDir, "tasks", project.name),
    worktreesDir: join(globalDir, "worktrees", project.name),
    brainstormDir: join(globalDir, "brainstorm", project.name)
  };
};

export const isInProjectContext = async (cwd?: string): Promise<boolean> => {
  const paths = await resolvePaths(cwd);
  return paths !== null;
};
