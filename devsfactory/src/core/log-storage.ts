import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";

export class LogStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  getLogPath(taskFolder: string, subtaskFile: string): string {
    const subtaskName = subtaskFile.replace(/\.md$/, "");
    return join(
      this.baseDir,
      ".devsfactory",
      taskFolder,
      "logs",
      `${subtaskName}.log`
    );
  }

  async append(
    taskFolder: string,
    subtaskFile: string,
    line: string
  ): Promise<void> {
    const logPath = this.getLogPath(taskFolder, subtaskFile);
    await mkdir(dirname(logPath), { recursive: true });
    const file = await open(logPath, "a");
    try {
      await file.write(`${line}\n`);
    } finally {
      await file.close();
    }
  }

  async read(taskFolder: string, subtaskFile: string): Promise<string[]> {
    const logPath = this.getLogPath(taskFolder, subtaskFile);
    const file = Bun.file(logPath);

    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    if (!content) {
      return [];
    }

    const lines = content.split("\n");
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }
}
