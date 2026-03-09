const requireEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const requireEnvNumber = (key: string): number => {
  const value = requireEnv(key);
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number for ${key}: ${value}`);
  }
  return parsed;
};

/** Ports for binding - what port the server listens on */
export const AOP_PORTS = {
  get SERVER() {
    return requireEnvNumber("AOP_SERVER_PORT");
  },
  get LOCAL_SERVER() {
    return requireEnvNumber("AOP_LOCAL_SERVER_PORT");
  },
  get DASHBOARD() {
    return requireEnvNumber("AOP_DASHBOARD_PORT");
  },
  /** Sidecar port range for Electron (local-server embedded in app) */
  SIDECAR_PORT_START: 3847,
  SIDECAR_PORT_END: 3899,
} as const;

/** URLs for connecting - how to reach services (can differ from binding port in prod behind proxy) */
export const AOP_URLS = {
  get SERVER() {
    return requireEnv("AOP_SERVER_URL");
  },
  get LOCAL_SERVER() {
    return requireEnv("AOP_LOCAL_SERVER_URL");
  },
  get DASHBOARD() {
    return requireEnv("AOP_DASHBOARD_URL");
  },
  get DATABASE() {
    return requireEnv("AOP_DATABASE_URL");
  },
  get DATABASE_TEST() {
    return `${requireEnv("AOP_DATABASE_URL")}_test`;
  },
} as const;
