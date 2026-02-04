import YAML from "yaml";
import type { WorkflowDefinition } from "./types.ts";
import { validateAndParseWorkflow, WorkflowParseError } from "./workflow-parser.ts";

export const parseWorkflowYaml = (yamlContent: string): WorkflowDefinition => {
  let data: unknown;
  try {
    data = YAML.parse(yamlContent);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new WorkflowParseError(`Invalid YAML syntax: ${message}`);
  }

  return validateAndParseWorkflow(data);
};
