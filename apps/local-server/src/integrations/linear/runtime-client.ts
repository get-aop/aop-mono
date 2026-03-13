import { createLinearClient } from "./client.ts";
import { createLinearFixtureClient } from "./fixture-client.ts";

interface CreateRuntimeLinearClientOptions {
  apiKey?: string;
  getAccessToken?: () => Promise<string | null>;
}

export const createRuntimeLinearClient = (options: CreateRuntimeLinearClientOptions) => {
  const fixturesPath = process.env.AOP_TEST_LINEAR_FIXTURES_PATH?.trim();
  if (process.env.AOP_TEST_MODE === "true" && fixturesPath) {
    return createLinearFixtureClient({ fixturesPath });
  }

  return createLinearClient(options);
};
