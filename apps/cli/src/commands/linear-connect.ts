import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";
import { promptForPassphrase } from "./linear-passphrase.ts";

const logger = getLogger("cli", "linear-connect");

interface LinearConnectResponse {
  authorizeUrl: string;
}

export const linearConnectCommand = async (): Promise<void> => {
  await requireServer();

  const passphrase = await promptForPassphrase();
  if (!passphrase) {
    logger.error("Linear passphrase is required");
    process.exit(1);
  }

  const result = await fetchServer<LinearConnectResponse>("/api/linear/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });

  if (!result.ok) {
    logger.error("Failed to start Linear OAuth: {error}", { error: result.error.error });
    process.exit(1);
  }

  logger.info("Open this URL to authorize Linear:");
  logger.info(result.data.authorizeUrl);
};
