export const DEFAULT_PORT = 3847;
export const DEFAULT_DASHBOARD_PORT = 5173;

export const getPort = (): number =>
  Number.parseInt(process.env.AOP_PORT ?? String(DEFAULT_PORT), 10);

export const getDashboardStaticPath = (): string | undefined => process.env.DASHBOARD_STATIC_PATH;

export const getDashboardDevOrigin = (): string | undefined => {
  const port = process.env.DASHBOARD_PORT ?? String(DEFAULT_DASHBOARD_PORT);
  return process.env.NODE_ENV === "production" ? undefined : `http://localhost:${port}`;
};
