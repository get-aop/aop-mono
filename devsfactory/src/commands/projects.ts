import {
  listProjects,
  type ProjectRecord,
  unregisterProject
} from "../core/sqlite/project-store";

export type ProjectsSubcommand = "list" | "remove";

export interface ProjectsArgs {
  subcommand: ProjectsSubcommand;
  projectName?: string;
  error?: string;
}

export interface ProjectsResult {
  success: boolean;
  output?: string;
  error?: string;
}

export const parseProjectsArgs = (args: string[]): ProjectsArgs => {
  if (args.length === 0) {
    return { subcommand: "list" };
  }

  const first = args[0]!;

  if (first.startsWith("-")) {
    return { subcommand: "list", error: `Unknown option: ${first}` };
  }

  if (first === "remove") {
    const projectName = args[1];
    if (!projectName) {
      return {
        subcommand: "remove",
        error: "Missing project name for remove command"
      };
    }
    return { subcommand: "remove", projectName };
  }

  return { subcommand: "list", error: `Unknown subcommand: ${first}` };
};

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatTable = (projects: ProjectRecord[]): string => {
  const headers = ["NAME", "PATH", "REGISTERED"];
  const rows = projects.map((p) => [
    p.name,
    p.path,
    formatDate(p.registeredAt)
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length))
  );

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(colWidths[i]!)).join("  ");

  const lines = [formatRow(headers), ...rows.map(formatRow)];
  return lines.join("\n");
};

export const runProjectsCommand = async (
  subcommand: ProjectsSubcommand,
  projectName: string | undefined
): Promise<ProjectsResult> => {
  try {
    if (subcommand === "remove") {
      unregisterProject(projectName!);
      return {
        success: true,
        output: `✓ Unregistered project '${projectName}'`
      };
    }

    const projects = listProjects();

    if (projects.length === 0) {
      return {
        success: true,
        output:
          "No projects registered. Run 'aop init' in a git repository to get started."
      };
    }

    return {
      success: true,
      output: formatTable(projects)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};
