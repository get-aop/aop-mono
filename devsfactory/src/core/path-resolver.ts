import { join } from "node:path";
import type { ResolvedPaths } from "../types";
import { getGlobalDir } from "./global-bootstrap";
import { findProjectByPath, getProjectByName } from "./sqlite/project-store";

export const resolvePaths = async (
  cwd?: string
): Promise<ResolvedPaths | null> => {
  const workingDir = cwd ?? process.cwd();

  const project = await findProjectByPath(workingDir);
  if (project) {
    const globalDir = getGlobalDir();
    return {
      mode: "global",
      projectName: project.name,
      projectRoot: project.path,
      devsfactoryDir: join(globalDir, "tasks", project.name),
      worktreesDir: join(globalDir, "worktrees", project.name)
    };
  }

  return null;
};

export const resolvePathsForProject = async (
  projectName: string
): Promise<ResolvedPaths | null> => {
  const project = getProjectByName(projectName);
  if (!project) {
    return null;
  }

  const globalDir = getGlobalDir();
  return {
    mode: "global",
    projectName: project.name,
    projectRoot: project.path,
    devsfactoryDir: join(globalDir, "tasks", project.name),
    worktreesDir: join(globalDir, "worktrees", project.name)
  };
};

export const isInProjectContext = async (cwd?: string): Promise<boolean> => {
  const paths = await resolvePaths(cwd);
  return paths !== null;
};
