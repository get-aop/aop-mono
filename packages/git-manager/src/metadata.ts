export interface WorktreeMetadata {
  branch: string;
  baseBranch: string;
  baseCommit: string;
}

/**
 * Worktree metadata persistence operations.
 */
export class MetadataStore {
  private readonly metadataDir: string;

  constructor(worktreesDir: string) {
    this.metadataDir = `${worktreesDir}/.metadata`;
  }

  async save(taskId: string, metadata: WorktreeMetadata): Promise<void> {
    await Bun.$`mkdir -p ${this.metadataDir}`.quiet();
    const path = this.getPath(taskId);
    await Bun.write(path, JSON.stringify(metadata, null, 2));
  }

  async get(taskId: string): Promise<WorktreeMetadata> {
    const path = this.getPath(taskId);
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(`Worktree metadata not found for task: ${taskId}`);
    }
    return file.json();
  }

  async delete(taskId: string): Promise<void> {
    const path = this.getPath(taskId);
    await Bun.$`rm -f ${path}`.quiet();
  }

  private getPath(taskId: string): string {
    return `${this.metadataDir}/${taskId}.json`;
  }
}
