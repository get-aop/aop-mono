// biome-ignore lint/suspicious/noConsole: CLI output must be plain text without log formatting
const log = (line: string): void => console.log(line);
// biome-ignore lint/suspicious/noConsole: CLI output must be plain text without log formatting
const err = (line: string): void => console.error(line);

export const printHelp = (): void => {
  log("Usage: aop <command> [args]");
  log("");
  log("Daemon Commands:");
  log("  start                    Start the daemon");
  log("  stop                     Stop the daemon");
  log("  status [task-id] [--json] Show status");
  log("");
  log("Repository Commands:");
  log("  repo:init [path]         Register repository");
  log("  repo:remove [path] [--force]  Unregister repository (--force aborts working tasks)");
  log("");
  log("Task Commands:");
  log("  task:ready <task-id>     Mark task as READY");
  log("  task:remove <task-id> [--force]  Remove task (--force aborts working task)");
  log("  task:run <task-id|path>  Run task manually (bypass queue)");
  log("  apply <task-id>          Apply worktree changes to main repo");
  log("");
  log("Config Commands:");
  log("  config:get [key]         Get config value(s)");
  log("  config:set <key> <value> Set config value");
};

export const printError = (message: string): void => err(`Error: ${message}`);
