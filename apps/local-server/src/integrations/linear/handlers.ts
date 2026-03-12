import type { LinearCallbackParams, LinearOAuth, LinearTokenSet, LinearTokenStore } from "./types.ts";

export interface LinearConnectionInfo {
  ok: boolean;
  organizationName: string;
  userName: string;
  userEmail: string;
}

export interface LinearHandlers {
  connect(): Promise<{ authorizeUrl: string }>;
  callback(params: LinearCallbackParams): Promise<{ connected: boolean }>;
  getStatus(): Promise<{ connected: boolean; locked: boolean }>;
  unlock(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<LinearConnectionInfo>;
}

export interface CreateLinearHandlersOptions {
  createAuth: (options: { clientId: string; redirectUri: string }) => LinearOAuth;
  getConfig: () => Promise<{
    enabled: boolean;
    clientId: string;
    redirectUri: string;
  }>;
  tokenStore: LinearTokenStore;
  exchangeCodeForTokens: (params: {
    clientId: string;
    code: string;
    verifier: string;
    redirectUri: string;
  }) => Promise<LinearTokenSet>;
  testConnectionWithToken: (accessToken: string) => Promise<LinearConnectionInfo>;
}

export class LinearHandlersError extends Error {
  status: 400 | 409 | 503;

  constructor(status: 400 | 409 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

export const createLinearHandlers = (options: CreateLinearHandlersOptions): LinearHandlers => {
  const sessions = new Map<
    string,
    {
      auth: LinearOAuth;
      clientId: string;
      redirectUri: string;
    }
  >();

  const getEnabledConfig = async (): Promise<{ clientId: string; redirectUri: string }> => {
    const config = await options.getConfig();
    if (!config.enabled) {
      throw new LinearHandlersError(
        503,
        "Linear OAuth is not configured. Set linear_client_id and linear_callback_url in Settings or via the CLI.",
      );
    }
    return {
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    };
  };

  return {
    connect: async () => {
      const config = await getEnabledConfig();
      const auth = options.createAuth(config);
      const request = auth.createAuthorizationRequest();
      sessions.set(request.state, {
        auth,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
      });
      return { authorizeUrl: request.url.toString() };
    },

    callback: async (params: LinearCallbackParams) => {
      const state = params.state ?? "";
      const session = sessions.get(state);
      if (!session) {
        throw new LinearHandlersError(400, "Invalid Linear OAuth state");
      }

      const { code } = session.auth.validateCallback(params);
      const verifier = session.auth.consumeVerifier(state);
      sessions.delete(state);

      if (!verifier) {
        throw new LinearHandlersError(400, "Linear OAuth session expired");
      }

      const tokens = await options.exchangeCodeForTokens({
        clientId: session.clientId,
        code,
        verifier,
        redirectUri: session.redirectUri,
      });
      await options.tokenStore.save(tokens);

      return { connected: true };
    },

    getStatus: async () => options.tokenStore.getStatus(),

    unlock: async () => {
      await options.tokenStore.unlock();
    },

    disconnect: async () => {
      await options.tokenStore.disconnect();
    },

    testConnection: async () => {
      await getEnabledConfig();
      const tokens = await options.tokenStore.read().catch((error) => {
        if (error instanceof Error && error.message === "Linear token store is locked") {
          throw new LinearHandlersError(409, error.message);
        }
        throw error;
      });

      return options.testConnectionWithToken(tokens.accessToken);
    },
  };
};
