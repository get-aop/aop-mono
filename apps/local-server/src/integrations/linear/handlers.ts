import type { LinearCallbackParams, LinearOAuth, LinearTokenSet, LinearTokenStore } from "./types.ts";

export interface LinearConnectionInfo {
  ok: boolean;
  organizationName: string;
  userName: string;
  userEmail: string;
}

export interface LinearHandlers {
  connect(passphrase: string): Promise<{ authorizeUrl: string }>;
  callback(params: LinearCallbackParams): Promise<{ connected: boolean }>;
  getStatus(): Promise<{ connected: boolean; locked: boolean }>;
  unlock(passphrase: string): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<LinearConnectionInfo>;
}

export interface CreateLinearHandlersOptions {
  auth: LinearOAuth;
  tokenStore: LinearTokenStore;
  exchangeCodeForTokens: (params: { code: string; verifier: string }) => Promise<LinearTokenSet>;
  testConnectionWithToken: (accessToken: string) => Promise<LinearConnectionInfo>;
  enabled?: boolean;
}

export class LinearHandlersError extends Error {
  status: 400 | 409 | 503;

  constructor(status: 400 | 409 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

export const createLinearHandlers = (options: CreateLinearHandlersOptions): LinearHandlers => {
  const pendingPassphrases = new Map<string, string>();

  const assertEnabled = (): void => {
    if (options.enabled === false) {
      throw new LinearHandlersError(503, "Linear OAuth is not configured");
    }
  };

  return {
    connect: async (passphrase: string) => {
      assertEnabled();
      const request = options.auth.createAuthorizationRequest();
      pendingPassphrases.set(request.state, passphrase);
      return { authorizeUrl: request.url.toString() };
    },

    callback: async (params: LinearCallbackParams) => {
      assertEnabled();
      const { code, state } = options.auth.validateCallback(params);
      const verifier = options.auth.consumeVerifier(state);
      const passphrase = pendingPassphrases.get(state);
      pendingPassphrases.delete(state);

      if (!verifier || !passphrase) {
        throw new LinearHandlersError(400, "Linear OAuth session expired");
      }

      const tokens = await options.exchangeCodeForTokens({ code, verifier });
      await options.tokenStore.save(tokens, passphrase);

      return { connected: true };
    },

    getStatus: async () => options.tokenStore.getStatus(),

    unlock: async (passphrase: string) => {
      await options.tokenStore.unlock(passphrase);
    },

    disconnect: async () => {
      pendingPassphrases.clear();
      await options.tokenStore.disconnect();
    },

    testConnection: async () => {
      assertEnabled();
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
