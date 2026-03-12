import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "linear-unlock");

export const linearUnlockCommand = async (): Promise<void> => {
  await requireServer();

  const result = await fetchServer<{ ok: boolean }>("/api/linear/unlock", {
    method: "POST",
  });

  if (!result.ok) {
    logger.error("Failed to unlock Linear: {error}", { error: result.error.error });
    process.exit(1);
  }

  logger.info("Linear unlocked");
};
