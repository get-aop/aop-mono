import type { Kysely } from "kysely";
import type { Database } from "../schema.ts";
import { createClientsMigration } from "./001-create-clients.ts";
import { createWorkflowsMigration } from "./002-create-workflows.ts";
import { createReposMigration } from "./003-create-repos.ts";
import { createTasksMigration } from "./004-create-tasks.ts";
import { createExecutionsMigration } from "./005-create-executions.ts";
import { createStepExecutionsMigration } from "./006-create-step-executions.ts";
import { seedTestClientMigration } from "./007-seed-test-client.ts";
import { seedSimpleWorkflowMigration } from "./008-seed-simple-workflow.ts";
import { addSignalToStepExecutionsMigration } from "./009-add-signal-to-step-executions.ts";
import { seedRalphLoopWorkflowMigration } from "./010-seed-ralph-loop-workflow.ts";
import { addCancelledStatusMigration } from "./011-add-cancelled-status.ts";
import { addIterationTrackingMigration } from "./012-add-iteration-tracking.ts";

export interface Migration {
  name: string;
  up: (db: Kysely<Database>) => Promise<void>;
  down: (db: Kysely<Database>) => Promise<void>;
}

export const getMigrations = (): Migration[] => {
  return [
    createClientsMigration,
    createWorkflowsMigration,
    createReposMigration,
    createTasksMigration,
    createExecutionsMigration,
    createStepExecutionsMigration,
    seedTestClientMigration,
    seedSimpleWorkflowMigration,
    addSignalToStepExecutionsMigration,
    seedRalphLoopWorkflowMigration,
    addCancelledStatusMigration,
    addIterationTrackingMigration,
  ];
};
