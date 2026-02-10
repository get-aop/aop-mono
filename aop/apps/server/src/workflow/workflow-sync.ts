import { randomUUID } from "node:crypto";
import { getLogger } from "@aop/infra";
import type { WorkflowDefinition } from "./types.ts";
import type { WorkflowRepository } from "./workflow-repository.ts";

const logger = getLogger("workflow-sync");

export const syncWorkflows = async (
  repository: WorkflowRepository,
  workflows: WorkflowDefinition[],
): Promise<{ inserted: number; updated: number; deactivated: number }> => {
  const log = logger.with({ count: workflows.length });
  log.info("Starting workflow sync with {count} workflows");

  let inserted = 0;
  let updated = 0;

  const fileNames = new Set(workflows.map((w) => w.name));

  for (const workflow of workflows) {
    const existing = await repository.findByName(workflow.name);
    const definition = JSON.stringify(workflow);

    await repository.upsert({
      id: existing?.id ?? randomUUID(),
      name: workflow.name,
      definition,
    });

    if (existing) {
      updated++;
      log.info("Updated workflow {name}", { name: workflow.name });
    } else {
      inserted++;
      log.info("Inserted workflow {name}", { name: workflow.name });
    }
  }

  const dbNames = await repository.listAllNames();
  const staleNames = dbNames.filter((name) => !fileNames.has(name));
  let deactivated = 0;

  for (const name of staleNames) {
    const wasDeactivated = await repository.deactivateByName(name);
    if (wasDeactivated) {
      deactivated++;
      log.info("Deactivated stale workflow {name}", { name });
    }
  }

  log.info(
    "Workflow sync complete: {inserted} inserted, {updated} updated, {deactivated} deactivated",
    { inserted, updated, deactivated },
  );
  return { inserted, updated, deactivated };
};
