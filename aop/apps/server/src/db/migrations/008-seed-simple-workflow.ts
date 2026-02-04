import type { Migration } from "./index.ts";

// Workflow seeding moved to YAML files loaded at server startup.
// Migration kept as no-op to preserve migration history.
export const seedSimpleWorkflowMigration: Migration = {
  name: "008-seed-simple-workflow",
  up: async () => {},
  down: async () => {},
};
