/**
 * Validates that a taskId is safe for use in file paths and git branch names.
 * Prevents path traversal attacks and invalid git refs.
 */
export const validateTaskId = (taskId: string): void => {
  if (!taskId || taskId.length === 0) {
    throw new Error("taskId cannot be empty");
  }

  if (taskId.length > 100) {
    throw new Error("taskId exceeds maximum length of 100 characters");
  }

  // Check for path traversal patterns first (higher priority security check)
  if (taskId.includes("..") || taskId.includes("//")) {
    throw new Error(`Invalid taskId "${taskId}": contains path traversal pattern`);
  }

  // Allow alphanumeric, hyphens, underscores, and forward slashes (for namespaced tasks like "feat/auth")
  // Disallow: leading/trailing slashes, and special characters
  const VALID_TASK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_/-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

  if (!VALID_TASK_ID.test(taskId)) {
    throw new Error(
      `Invalid taskId "${taskId}": must contain only alphanumeric characters, hyphens, underscores, or forward slashes, and cannot start/end with special characters`,
    );
  }
};
