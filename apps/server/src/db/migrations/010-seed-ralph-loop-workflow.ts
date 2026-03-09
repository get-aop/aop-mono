import type { Migration } from "./index.ts";

// Workflow seeding moved to YAML files loaded at server startup.
// Migration kept as no-op to preserve migration history.
export const seedRalphLoopWorkflowMigration: Migration = {
  name: "010-seed-ralph-loop-workflow",
  up: async () => {},
  down: async () => {},
};
