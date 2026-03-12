import type { Kysely } from "kysely";
import type { Database } from "./db/schema.ts";
import {
  getLogBuffer,
  getTaskEventEmitter,
  type LogBuffer,
  type TaskEventEmitter,
} from "./events/index.ts";
import {
  createExecutionRepository,
  type ExecutionRepository,
} from "./executor/execution-repository.ts";
import { createLogFlusher, type LogFlusher } from "./executor/log-flusher.ts";
import { createLinearHandlers, type LinearHandlers } from "./integrations/linear/handlers.ts";
import { createLinearOAuth } from "./integrations/linear/oauth.ts";
import { createLinearStore, type LinearStore } from "./integrations/linear/store.ts";
import {
  createLinearTokenStore,
  type LinearTokenStore,
} from "./integrations/linear/token-store.ts";
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { createSessionRepository, type SessionRepository } from "./session/repository.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { SettingKey } from "./settings/types.ts";
import { createTaskRepository, type TaskRepository } from "./task/repository.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./workflow/repository.ts";
import { createLocalWorkflowService, type LocalWorkflowService } from "./workflow/service.ts";

export interface LocalServerContext {
  taskRepository: TaskRepository;
  repoRepository: RepoRepository;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
  sessionRepository: SessionRepository;
  workflowRepository: WorkflowRepository;
  taskEventEmitter: TaskEventEmitter;
  logBuffer: LogBuffer;
  logFlusher: LogFlusher;
  workflowService: LocalWorkflowService;
  linearHandlers: LinearHandlers;
  linearStore: LinearStore;
  linearTokenStore: LinearTokenStore;
}

export interface CreateCommandContextOptions {
  taskEventEmitter?: TaskEventEmitter;
  logBuffer?: LogBuffer;
  logFlusher?: LogFlusher;
}

export const createCommandContext = (
  db: Kysely<Database>,
  options: CreateCommandContextOptions = {},
): LocalServerContext => {
  const taskEventEmitter = options.taskEventEmitter ?? getTaskEventEmitter();
  const logBuffer = options.logBuffer ?? getLogBuffer();
  const repoRepository = createRepoRepository(db);
  const settingsRepository = createSettingsRepository(db);
  const executionRepository = createExecutionRepository();
  const logFlusher = options.logFlusher ?? createLogFlusher(executionRepository);
  const linearStore = createLinearStore(db);
  const tokenStore = createLinearTokenStore();
  const linearHandlers = createLinearHandlers({
    createAuth: createLinearOAuth,
    getConfig: async () => {
      const configuredClientId = await settingsRepository.get(SettingKey.LINEAR_CLIENT_ID);
      const configuredCallbackUrl = await settingsRepository.get(SettingKey.LINEAR_CALLBACK_URL);
      const redirectUri = resolveLinearCallbackUrl({
        configuredCallbackUrl,
        env: process.env,
      });

      if (configuredCallbackUrl !== redirectUri && configuredCallbackUrl.length > 0) {
        await settingsRepository.set(SettingKey.LINEAR_CALLBACK_URL, redirectUri);
      }

      const clientId = configuredClientId || process.env.AOP_LINEAR_CLIENT_ID || "";

      return {
        enabled: clientId.length > 0 && redirectUri.length > 0,
        clientId,
        redirectUri,
      };
    },
    tokenStore,
    exchangeCodeForTokens: ({ clientId, code, verifier, redirectUri }) =>
      exchangeLinearCodeForTokens({ clientId, code, verifier, redirectUri }),
    testConnectionWithToken: testLinearConnection,
  });

  const context = {
    taskRepository: createTaskRepository(db, {
      eventEmitter: taskEventEmitter,
    }),
    repoRepository,
    settingsRepository,
    executionRepository,
    sessionRepository: createSessionRepository(db),
    workflowRepository: createWorkflowRepository(db),
    taskEventEmitter,
    logBuffer,
    logFlusher,
    linearHandlers,
    linearStore,
    linearTokenStore: tokenStore,
  } as LocalServerContext;

  context.workflowService = createLocalWorkflowService(context);

  return context;
};

export const resolveLinearCallbackUrl = ({
  configuredCallbackUrl,
  env,
}: {
  configuredCallbackUrl: string;
  env: NodeJS.ProcessEnv;
}): string => {
  if (!configuredCallbackUrl.length) {
    return getDefaultLinearCallbackUrl(env);
  }

  return isLegacyLinearCallbackUrl(configuredCallbackUrl)
    ? getDefaultLinearCallbackUrl(env)
    : configuredCallbackUrl;
};

const getDefaultLinearCallbackUrl = (env: NodeJS.ProcessEnv): string => {
  const callbackBase =
    env.AOP_LINEAR_CALLBACK_BASE ?? env.AOP_LOCAL_SERVER_URL ?? "http://127.0.0.1:4310";
  return new URL("/api/linear/callback", callbackBase).toString();
};

const isLegacyLinearCallbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "4310" &&
      url.pathname === "/api/linear/callback"
    );
  } catch {
    return false;
  }
};

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

export const exchangeLinearCodeForTokens = async (params: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}) => {
  const requestBody = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.verifier,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
  });

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const suffix = errorBody ? `: ${errorBody}` : "";
    throw new Error(`Linear OAuth token exchange failed (${response.status})${suffix}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== "number") {
    throw new Error("Linear OAuth token exchange returned an invalid payload");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
};

export const testLinearConnection = async (accessToken: string) => {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: "query LinearViewer { viewer { name email organization { name } } }",
    }),
  });

  if (!response.ok) {
    throw new Error(`Linear test connection failed (${response.status})`);
  }

  const body = (await response.json()) as {
    data?: {
      viewer?: {
        name?: string | null;
        email?: string | null;
        organization?: {
          name?: string | null;
        } | null;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? "Linear test connection failed");
  }

  const viewer = body.data?.viewer;
  if (!viewer?.name || !viewer.email || !viewer.organization?.name) {
    throw new Error("Linear test connection returned an invalid payload");
  }

  return {
    ok: true,
    organizationName: viewer.organization.name,
    userName: viewer.name,
    userEmail: viewer.email,
  };
};
