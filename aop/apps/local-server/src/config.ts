import { AOP_PORTS, AOP_URLS } from "@aop/common";

export const getPort = (): number => AOP_PORTS.LOCAL_SERVER;

export const getDashboardStaticPath = (): string | undefined => process.env.DASHBOARD_STATIC_PATH;

export const getDashboardDevOrigin = (): string | undefined => {
  return process.env.NODE_ENV === "production" ? undefined : AOP_URLS.DASHBOARD;
};
