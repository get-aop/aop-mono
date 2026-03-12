export interface LinearAuthorizationRequest {
  url: URL;
  state: string;
  verifier: string;
}

export interface LinearCallbackParams {
  code?: string | null;
  error?: string | null;
  errorDescription?: string | null;
  state?: string | null;
}

export interface LinearTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface LinearTokenStoreStatus {
  connected: boolean;
  locked: boolean;
}

export interface LinearIssueRefList {
  refs: string[];
}

export interface LinearRawIssueSummary {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export interface LinearRawIssueRelation {
  type?: string | null;
  relatedIssue?: LinearRawIssueSummary | null;
}

export interface LinearRawIssue extends LinearRawIssueSummary {
  relations?: {
    nodes?: LinearRawIssueRelation[];
  } | null;
}

export interface LinearIssueSummary {
  id: string;
  ref: string;
  title: string;
  url: string;
}

export interface LinearResolvedIssue extends LinearIssueSummary {
  blocks: LinearIssueSummary[];
}

export interface LinearOAuth {
  createAuthorizationRequest(): LinearAuthorizationRequest;
  consumeVerifier(state: string): string | null;
  validateCallback(params: LinearCallbackParams): { code: string; state: string };
}

export interface LinearTokenStore {
  save(tokens: LinearTokenSet): Promise<void>;
  getStatus(): Promise<LinearTokenStoreStatus>;
  unlock(): Promise<void>;
  read(): Promise<LinearTokenSet>;
  lock(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface LinearIssueClient {
  getIssuesByRefs(refs: string[]): Promise<LinearRawIssue[]>;
}

export interface LinearRoutesDeps {
  handlers: {
    connect(): Promise<{ authorizeUrl: string }> | { authorizeUrl: string };
    callback(
      params: LinearCallbackParams,
    ): Promise<{ connected: boolean }> | { connected: boolean };
    getStatus(): Promise<LinearTokenStoreStatus> | LinearTokenStoreStatus;
    unlock(): Promise<void>;
    disconnect(): Promise<void>;
    testConnection(): Promise<{
      ok: boolean;
      organizationName: string;
      userName: string;
      userEmail: string;
    }>;
  };
  importFromInput?(params: { cwd: string; input: string }): Promise<{
    repoId: string;
    alreadyExists: boolean;
    imported: Array<{
      taskId: string;
      ref: string;
      changePath: string;
      requested: boolean;
      dependencyImported: boolean;
    }>;
    failures: Array<{
      ref: string;
      error: string;
    }>;
  }>;
}
