/**
 * @deprecated Migration-only module containing parsers for legacy markdown files.
 * Used exclusively by the `aop migrate` command to import existing files into SQLite.
 *
 * These parsers read from the filesystem and should NOT be used for normal operations.
 * All task data should be read from and written to SQLiteTaskStorage instead.
 */

export { parseFrontmatter, serializeFrontmatter } from "./frontmatter";
export { parsePlan } from "./plan-parser";
export { getReadySubtasks, listSubtasks, parseSubtask } from "./subtask-parser";
export { listTaskFolders, parseTask } from "./task-parser";
