import type { Result } from "@aop/common";
import { err, ok } from "@aop/common";
import type { AuthResponse } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { Client } from "../db/schema.ts";
import type { ClientRepository } from "./client-repository.ts";

const logger = getLogger("client-service");

export interface AuthSuccessResponse {
  client: Client;
  authResponse: AuthResponse;
}

export type AuthenticateResult = Result<AuthSuccessResponse, "missing_api_key" | "invalid_api_key">;

export interface ClientService {
  authenticate: (
    apiKey: string | undefined,
    requestedMaxConcurrentTasks?: number,
  ) => Promise<AuthenticateResult>;
}

export const createClientService = (clientRepo: ClientRepository): ClientService => ({
  authenticate: async (apiKey, requestedMaxConcurrentTasks) => {
    if (!apiKey) {
      return err("missing_api_key");
    }

    const client = await clientRepo.findByApiKey(apiKey);
    if (!client) {
      return err("invalid_api_key");
    }

    await clientRepo.updateLastSeen(client.id, new Date());

    const effectiveMaxConcurrentTasks = requestedMaxConcurrentTasks
      ? Math.min(requestedMaxConcurrentTasks, client.max_concurrent_tasks)
      : client.max_concurrent_tasks;

    logger.info("Client authenticated {clientId}", { clientId: client.id });
    return ok({
      client,
      authResponse: {
        clientId: client.id,
        effectiveMaxConcurrentTasks,
      },
    });
  },
});
