import { getLogger } from "@aop/infra";
import { createSpinner } from "../format/spinner.ts";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("aop", "cli", "run-task");

interface RunTaskSuccessResponse {
  status: "success";
  changeName: string;
  sessionId: string;
  warning?: string;
}

export const runTaskCommand = async (changeName: string): Promise<void> => {
  await requireServer();
  const cwd = process.cwd();

  const spinner = createSpinner("Running task");
  try {
    const result = await fetchServer<RunTaskSuccessResponse>("/api/run-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changeName, cwd }),
    });

    spinner.stop();

    if (!result.ok) {
      logger.error("Failed to run task: {error}", { error: result.error.error });
      process.exit(1);
    }

    if (result.data.warning) {
      logger.warn(result.data.warning);
    }

    logger.info("Change created: {changeName}", { changeName: result.data.changeName });
  } catch (err) {
    spinner.stop();
    logger.error("Failed to run task: {error}", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
};
