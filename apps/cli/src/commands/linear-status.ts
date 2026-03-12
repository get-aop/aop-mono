import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "linear-status");

interface LinearStatusResponse {
  connected: boolean;
  locked: boolean;
}

interface LinearConnectionInfo {
  ok: boolean;
  organizationName: string;
  userName: string;
  userEmail: string;
}

export const linearStatusCommand = async (): Promise<void> => {
  await requireServer();

  const statusResult = await fetchServer<LinearStatusResponse>("/api/linear/status");
  if (!statusResult.ok) {
    logger.error("Failed to load Linear status: {error}", { error: statusResult.error.error });
    process.exit(1);
  }

  if (!statusResult.data.connected) {
    logger.info("Linear: disconnected");
    return;
  }

  if (statusResult.data.locked) {
    logger.info("Linear: connected (locked)");
    return;
  }

  const infoResult = await fetchServer<LinearConnectionInfo>("/api/linear/test-connection", {
    method: "POST",
  });
  if (!infoResult.ok) {
    logger.error("Failed to test Linear connection: {error}", { error: infoResult.error.error });
    process.exit(1);
  }

  logger.info("Linear: connected");
  logger.info("Organization: {organizationName}", {
    organizationName: infoResult.data.organizationName,
  });
  logger.info("User: {userName}", { userName: infoResult.data.userName });
  logger.info("Email: {userEmail}", { userEmail: infoResult.data.userEmail });
};
