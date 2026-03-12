import { getLogger } from "@aop/infra";

const logger = getLogger("cli", "client");

const HEALTH_CHECK_TIMEOUT_MS = 1000;
const DEFAULT_LOCAL_SERVER_URL = "http://127.0.0.1:25150";

export const getServerUrl = (): string => {
  const configuredUrl = process.env.AOP_LOCAL_SERVER_URL?.trim();
  return configuredUrl && configuredUrl.length > 0 ? configuredUrl : DEFAULT_LOCAL_SERVER_URL;
};

export const isServerRunning = async (): Promise<boolean> => {
  const serverUrl = getServerUrl();
  try {
    const response = await fetch(`${serverUrl}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const requireServer = async (): Promise<void> => {
  const running = await isServerRunning();
  if (!running) {
    logger.error("Local server not running. Start it with: bun run apps/local-server/src/run.ts");
    process.exit(1);
  }
};

export interface ServerError {
  error: string;
  [key: string]: unknown;
}

export const fetchServer = async <T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: ServerError; status: number }> => {
  const serverUrl = getServerUrl();
  const response = await fetch(`${serverUrl}${path}`, options);

  if (!response.ok) {
    const error = (await response.json()) as ServerError;
    return { ok: false, error, status: response.status };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
};
