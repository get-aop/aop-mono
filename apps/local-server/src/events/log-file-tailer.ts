import { existsSync, readFileSync, statSync } from "node:fs";

export interface LogFileSnapshot {
  lines: string[];
  lineCount: number;
}

export const readLogLines = (logFile: string, offset = 0): LogFileSnapshot => {
  if (!existsSync(logFile)) {
    return { lines: [], lineCount: 0 };
  }

  const content = readFileSync(logFile, "utf-8");
  const allLines = content.split("\n").filter((line) => line.length > 0);
  const lines = offset > 0 ? allLines.slice(offset) : allLines;
  return { lines, lineCount: allLines.length };
};

export const getFileSize = (logFile: string): number => {
  try {
    return statSync(logFile).size;
  } catch {
    return 0;
  }
};
