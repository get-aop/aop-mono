import type { SignalDefinition } from "@aop/common/protocol";

export interface DetectSignalResult {
  signal: string | undefined;
  position: number | undefined;
}

/** Detects signal keywords in agent output. Signals must be wrapped in <aop>SIGNAL</aop> tags. */
export const detectSignal = (output: string, signals: SignalDefinition[]): DetectSignalResult => {
  if (!output || signals.length === 0) {
    return { signal: undefined, position: undefined };
  }

  let earliestMatch: { signal: string; position: number } | undefined;

  for (const signal of signals) {
    const pattern = `<aop>${signal.name}</aop>`;
    const position = output.indexOf(pattern);

    if (position !== -1) {
      if (!earliestMatch || position < earliestMatch.position) {
        earliestMatch = { signal: signal.name, position };
      }
    }
  }

  return earliestMatch
    ? { signal: earliestMatch.signal, position: earliestMatch.position }
    : { signal: undefined, position: undefined };
};
