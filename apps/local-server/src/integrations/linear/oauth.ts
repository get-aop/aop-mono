import { createHash, randomBytes } from "node:crypto";
import type { LinearAuthorizationRequest, LinearCallbackParams, LinearOAuth } from "./types.ts";

const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const DEFAULT_SCOPE = "read";

export const createLinearOAuth = (options: {
  clientId: string;
  redirectUri: string;
}): LinearOAuth => {
  const verifiersByState = new Map<string, string>();

  const createAuthorizationRequest = (): LinearAuthorizationRequest => {
    const state = createOpaqueValue();
    const verifier = createOpaqueValue();
    const challenge = createChallenge(verifier);
    const url = new URL(LINEAR_AUTHORIZE_URL);

    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("redirect_uri", options.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DEFAULT_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);

    verifiersByState.set(state, verifier);

    return { url, state, verifier };
  };

  const consumeVerifier = (state: string): string | null => {
    const verifier = verifiersByState.get(state) ?? null;
    if (verifier) {
      verifiersByState.delete(state);
    }
    return verifier;
  };

  const validateCallback = (params: LinearCallbackParams): { code: string; state: string } => {
    if (params.error) {
      throw new Error(`Linear OAuth error: ${params.error}`);
    }

    const state = getRequiredString(params.state, "Invalid Linear OAuth state");
    const code = getRequiredString(params.code, "Missing Linear OAuth authorization code");
    const verifier = verifiersByState.get(state);

    if (!verifier) {
      throw new Error("Invalid Linear OAuth state");
    }

    return { code, state };
  };

  return {
    createAuthorizationRequest,
    consumeVerifier,
    validateCallback,
  };
};

const createOpaqueValue = (): string => randomBytes(32).toString("base64url");

const createChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

const getRequiredString = (value: string | null | undefined, message: string): string => {
  if (!value) {
    throw new Error(message);
  }
  return value;
};
