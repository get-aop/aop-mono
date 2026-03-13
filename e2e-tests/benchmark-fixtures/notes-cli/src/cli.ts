import { readFileSync } from "node:fs";
import { parseNotes } from "./notes.ts";
import { renderPlainReport } from "./report.ts";

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const runCli = (args: string[], inputOverride?: string): CliRunResult => {
  const filePath = args[0];
  if (!filePath && !inputOverride) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Usage: bun src/cli.ts <notes-file>\n",
    };
  }

  const input = inputOverride ?? readFileSync(filePath, "utf8");
  const notes = parseNotes(input);

  return {
    exitCode: 0,
    stdout: `${renderPlainReport(notes)}\n`,
    stderr: "",
  };
};

if (import.meta.main) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exit(result.exitCode);
}
