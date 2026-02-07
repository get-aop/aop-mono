import type { AuthResponse } from "@aop/common/protocol";
import { getLogger } from "@aop/infra";
import type { ClientRepository } from "./client-repository.ts";

const logger = getLogger("client-service");

export interface AuthSuccess {
  success: true;
  response: AuthResponse;
}

export interface AuthError {
  success: false;
  error: "missing_api_key" | "invalid_api_key";
}

export type AuthenticateResult = AuthSuccess | AuthError;

export interface ClientService {
  authenticate: (
    apiKey: string | undefined,
    requestedMaxConcurrentTasks?: number,
  ) => Promise<AuthenticateResult>;
}

export const createClientService = (clientRepo: ClientRepository): ClientService => ({
  authenticate: async (apiKey, requestedMaxConcurrentTasks) => {
    if (!apiKey) {
      return { success: false, error: "missing_api_key" };
    }

    const client = await clientRepo.findByApiKey(apiKey);
    if (!client) {
      return { success: false, error: "invalid_api_key" };
    }

    await clientRepo.updateLastSeen(client.id, new Date());

    const effectiveMaxConcurrentTasks = requestedMaxConcurrentTasks
      ? Math.min(requestedMaxConcurrentTasks, client.max_concurrent_tasks)
      : client.max_concurrent_tasks;

    logger.info("Client authenticated {clientId}", { clientId: client.id });
    return {
      success: true,
      response: {
        clientId: client.id,
        effectiveMaxConcurrentTasks,
      },
    };
  },
});
