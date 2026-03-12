import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "linear-disconnect");

export const linearDisconnectCommand = async (): Promise<void> => {
  await requireServer();

  const result = await fetchServer<{ ok: boolean }>("/api/linear/disconnect", {
    method: "POST",
  });

  if (!result.ok) {
    logger.error("Failed to disconnect Linear: {error}", { error: result.error.error });
    process.exit(1);
  }

  logger.info("Linear disconnected");
};
