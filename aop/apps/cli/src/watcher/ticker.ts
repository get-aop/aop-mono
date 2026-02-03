import { getLogger } from "@aop/infra";

const logger = getLogger("aop", "ticker");

export interface TickerConfig {
  intervalMs: number;
}

export interface Ticker {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
}

export const createTicker = (onTick: () => Promise<void>, config: TickerConfig): Ticker => {
  let timer: Timer | null = null;
  let running = false;

  const tick = async () => {
    if (!running) return;

    try {
      await onTick();
    } catch (err) {
      logger.error("Ticker error: {error}", { error: String(err) });
    }

    if (running) {
      timer = setTimeout(tick, config.intervalMs);
    }
  };

  return {
    start: () => {
      if (running) {
        logger.warn("Ticker already running");
        return;
      }
      running = true;
      timer = setTimeout(tick, config.intervalMs);
      logger.info("Ticker started with interval {intervalMs}ms", { intervalMs: config.intervalMs });
    },

    stop: () => {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      logger.info("Ticker stopped");
    },

    isRunning: () => running,
  };
};
