import type { LocalWorkflowService } from "./service.ts";

export interface WorkflowListResult {
  workflows: string[];
}

export const listWorkflows = async (
  workflowService: LocalWorkflowService,
): Promise<WorkflowListResult> => {
  return { workflows: await workflowService.listWorkflows() };
};
