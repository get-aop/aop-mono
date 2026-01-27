import { mock } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mock git module by default for all orchestrator tests
// This is needed because createTaskWorktree and createSubtaskWorktree
// execute real git commands that fail in test environments
const __dirname = dirname(fileURLToPath(import.meta.url));
const gitModulePath = join(__dirname, "git");

mock.module(gitModulePath, () => {
  return {
    createTaskWorktree: mock(() => Promise.resolve("/mock/worktree/path")),
    createSubtaskWorktree: mock(() =>
      Promise.resolve("/mock/subtask/worktree/path")
    ),
    deleteWorktree: mock(() => Promise.resolve()),
    mergeSubtaskIntoTask: mock(() =>
      Promise.resolve({ success: true, commitSha: "abc123" })
    ),
    isGitRepo: mock(() => Promise.resolve(true)),
    getMainBranch: mock(() => Promise.resolve("main")),
    listWorktrees: mock(() => Promise.resolve([])),
    getCurrentBranch: mock(() => Promise.resolve("main"))
  };
});
