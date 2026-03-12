import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";
import { promptForPassphrase } from "./linear-passphrase.ts";

const logger = getLogger("cli", "linear-unlock");

export const linearUnlockCommand = async (): Promise<void> => {
  await requireServer();

  const passphrase = await promptForPassphrase();
  if (!passphrase) {
    logger.error("Linear passphrase is required");
    process.exit(1);
  }

  const result = await fetchServer<{ ok: boolean }>("/api/linear/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });

  if (!result.ok) {
    logger.error("Failed to unlock Linear: {error}", { error: result.error.error });
    process.exit(1);
  }

  logger.info("Linear unlocked");
};
