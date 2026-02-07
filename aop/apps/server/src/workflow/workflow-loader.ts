import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import { Glob } from "bun";
import type { WorkflowDefinition } from "./types.ts";
import { parseWorkflowYaml } from "./yaml-parser.ts";

const logger = getLogger("workflow-loader");

export class WorkflowLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLoadError";
  }
}

export const loadWorkflowsFromDirectory = async (
  workflowsDir: string,
): Promise<WorkflowDefinition[]> => {
  const dirStat = await stat(workflowsDir).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new WorkflowLoadError(`Workflows directory does not exist: ${workflowsDir}`);
  }

  const glob = new Glob("*.yaml");
  const files: string[] = [];

  for await (const file of glob.scan({ cwd: workflowsDir })) {
    files.push(file);
  }

  if (files.length === 0) {
    logger.warn("No workflow YAML files found in {dir}", { dir: workflowsDir });
    return [];
  }

  const workflows: WorkflowDefinition[] = [];

  for (const file of files) {
    const filePath = join(workflowsDir, file);
    const content = await Bun.file(filePath).text();
    const workflow = parseWorkflowYaml(content);
    workflows.push(workflow);
    logger.info("Loaded workflow {name} from {file}", { name: workflow.name, file });
  }

  return workflows;
};
