import { runAgent, showHelp as showAgentHelp } from "../agent";

export interface AgentArgs {
  help?: boolean;
  error?: string;
}

export const parseAgentArgs = (args: string[]): AgentArgs => {
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
  }
  return {};
};

export const agentCommand = async (args: string[]): Promise<void> => {
  const parsed = parseAgentArgs(args);

  if (parsed.help) {
    showAgentHelp();
    return;
  }

  await runAgent(args);
};
