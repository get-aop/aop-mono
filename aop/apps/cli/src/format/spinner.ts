const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type SpinnerDependencies = {
  clearInterval: typeof globalThis.clearInterval;
  intervalMs: number;
  now: () => number;
  setInterval: typeof globalThis.setInterval;
  write: (chunk: string) => void;
};

export const createSpinner = (
  label: string,
  dependencies: Partial<SpinnerDependencies> = {},
): { stop: () => void } => {
  const runtime: SpinnerDependencies = {
    clearInterval: globalThis.clearInterval,
    intervalMs: 120,
    now: Date.now,
    setInterval: globalThis.setInterval,
    write: (chunk: string) => {
      process.stdout.write(chunk);
    },
    ...dependencies,
  };

  const start = runtime.now();
  let frame = 0;
  const interval = runtime.setInterval(() => {
    const elapsed = Math.floor((runtime.now() - start) / 1000);
    const icon = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    runtime.write(`\r${icon} ${label} (${elapsed}s)`);
    frame++;
  }, runtime.intervalMs);

  return {
    stop: () => {
      runtime.clearInterval(interval);
      runtime.write("\r\x1b[K");
    },
  };
};
