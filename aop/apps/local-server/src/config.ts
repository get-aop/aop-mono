export const DEFAULT_PORT = 3847;

export const getPort = (): number =>
  Number.parseInt(process.env.AOP_PORT ?? String(DEFAULT_PORT), 10);
