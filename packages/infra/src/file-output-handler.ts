import { appendFileSync } from "node:fs";

/**
 * Handler function that processes output data records.
 * @param data - Parsed JSON data
 * @param rawLine - Original JSON string (avoids re-serialization when writing to file)
 */
export type OutputHandler = (data: Record<string, unknown>, rawLine?: string) => void;

/**
 * Options for creating a file output handler.
 */
export interface FileOutputHandlerOptions {
  /** Path to the JSONL log file */
  logFile: string;
  /** Optional callback invoked on each output event */
  onOutput?: OutputHandler;
}

/**
 * Create an output handler that writes each message as a JSON line to a file.
 * Optionally chains to another handler for additional processing (e.g., console logging).
 */
export const createFileOutputHandler = (options: FileOutputHandlerOptions): OutputHandler => {
  const { logFile, onOutput } = options;

  return (data: Record<string, unknown>, rawLine?: string) => {
    const line = rawLine ?? JSON.stringify(data);
    appendFileSync(logFile, `${line}\n`);
    onOutput?.(data, rawLine);
  };
};
