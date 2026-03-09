const quoteForPosixSh = (value: string): string => {
  return `'${value.replaceAll("'", "'\\''")}'`;
};

export const buildWslCommand = (command: string, env: Record<string, string>): string => {
  const exports = Object.entries(env)
    .map(([key, value]) => `export ${key}=${quoteForPosixSh(value)}`)
    .join("; ");

  return exports ? `${exports}; exec ${command}` : `exec ${command}`;
};
