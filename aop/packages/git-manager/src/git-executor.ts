/**
 * Low-level git command execution via Bun.$
 */
export class GitExecutor {
  constructor(private readonly defaultCwd: string) {}

  async exec(args: string[], cwd?: string): Promise<string> {
    const workDir = cwd ?? this.defaultCwd;
    const result = await Bun.$`git ${args}`.cwd(workDir).quiet().nothrow();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
    }
    return result.stdout.toString().trim();
  }

  async execRaw(
    args: string[],
    cwd?: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const workDir = cwd ?? this.defaultCwd;
    const result = await Bun.$`git ${args}`.cwd(workDir).quiet().nothrow();
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  }
}
