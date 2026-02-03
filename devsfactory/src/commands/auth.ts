export interface AuthArgs {
  help?: boolean;
  status?: boolean;
  error?: string;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  error?: string;
}

export const parseAuthArgs = (args: string[]): AuthArgs => {
  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (arg === "status" || arg === "--status") {
      return { status: true };
    }
    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }
  }
  return {};
};

const isClaudeInstalled = async (): Promise<boolean> => {
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe"
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
};

const isClaudeAuthenticated = async (): Promise<boolean> => {
  try {
    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "Say hello",
        "--max-turns",
        "1",
        "--output-format",
        "json"
      ],
      {
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
};

export const runAuthStatus = async (): Promise<AuthResult> => {
  const installed = await isClaudeInstalled();
  if (!installed) {
    return {
      success: false,
      error:
        "Claude Code is not installed.\n" +
        "Install it with: npm install -g @anthropic-ai/claude-code"
    };
  }

  const authenticated = await isClaudeAuthenticated();
  if (authenticated) {
    return {
      success: true,
      message: "Claude Code is installed and authenticated."
    };
  }

  return {
    success: false,
    error:
      "Claude Code is installed but not authenticated.\n" +
      "Run 'claude' to complete authentication."
  };
};

export const runAuthCommand = async (): Promise<AuthResult> => {
  const installed = await isClaudeInstalled();
  if (!installed) {
    return {
      success: false,
      error:
        "Claude Code is not installed.\n" +
        "Install it with: npm install -g @anthropic-ai/claude-code"
    };
  }

  console.log("Claude Code is installed. Checking authentication...\n");

  const authenticated = await isClaudeAuthenticated();
  if (authenticated) {
    return {
      success: true,
      message: "Claude Code is already authenticated and ready to use."
    };
  }

  console.log("Claude Code needs authentication.");
  console.log(
    "Run 'claude' in your terminal to complete the authentication flow.\n"
  );

  return {
    success: true,
    message: "Run 'claude' to authenticate."
  };
};
