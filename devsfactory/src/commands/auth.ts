import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_FILE = join(homedir(), ".claude-agi", "auth.json");

export interface AuthArgs {
  help?: boolean;
  status?: boolean;
  token?: string;
  error?: string;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  error?: string;
}

export const parseAuthArgs = (args: string[]): AuthArgs => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (arg === "status" || arg === "--status") {
      return { status: true };
    }
    if (arg === "--token" || arg === "-t") {
      const token = args[i + 1];
      if (!token || token.startsWith("-")) {
        return { error: "--token requires a value" };
      }
      return { token };
    }
    // Positional argument that looks like a token
    if (arg.startsWith("sk-ant-")) {
      return { token: arg };
    }
    if (arg.startsWith("-")) {
      return { error: `Unknown option: ${arg}` };
    }
  }
  return {};
};

export const getStoredApiKey = async (): Promise<string | null> => {
  // First check environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Then check stored auth file
  try {
    const file = Bun.file(AUTH_FILE);
    if (!(await file.exists())) {
      return null;
    }
    const data = await file.json();
    return data.apiKey ?? null;
  } catch {
    return null;
  }
};

export const storeApiKey = async (apiKey: string): Promise<void> => {
  const dir = join(homedir(), ".claude-agi");
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(AUTH_FILE, JSON.stringify({ apiKey }, null, 2));
};

export const runAuthStatus = async (): Promise<AuthResult> => {
  const apiKey = await getStoredApiKey();

  if (apiKey) {
    const source = process.env.ANTHROPIC_API_KEY
      ? "environment variable (ANTHROPIC_API_KEY)"
      : `stored in ${AUTH_FILE}`;
    const preview = `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`;
    return {
      success: true,
      message: `Authenticated\n  Token: ${preview}\n  Source: ${source}`
    };
  }

  return {
    success: false,
    error: "Not authenticated. Run 'aop auth' to set up authentication."
  };
};

export const runAuthWithToken = async (token: string): Promise<AuthResult> => {
  if (!token.startsWith("sk-ant-")) {
    return {
      success: false,
      error: "Invalid token format. Token should start with 'sk-ant-'"
    };
  }

  await storeApiKey(token);
  const preview = `${token.slice(0, 15)}...${token.slice(-4)}`;

  return {
    success: true,
    message: `Token stored successfully!\n  Token: ${preview}\n  Location: ${AUTH_FILE}`
  };
};

export const runAuthCommand = async (): Promise<AuthResult> => {
  // Check if already authenticated
  const existingKey = await getStoredApiKey();
  if (existingKey) {
    const preview = `${existingKey.slice(0, 15)}...${existingKey.slice(-4)}`;
    console.log(`Already authenticated (${preview})`);
    console.log("Running auth again will replace the existing token.\n");
  }

  console.log("Starting authentication flow...");
  console.log("This will open a browser window to authenticate with Claude.\n");

  // Run claude setup-token and capture output
  const proc = Bun.spawn(["claude", "setup-token"], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit"
  });

  let output = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    output += text;
    process.stdout.write(text);
  }

  await proc.exited;

  if (proc.exitCode !== 0) {
    return {
      success: false,
      error: `Authentication failed (exit code ${proc.exitCode})`
    };
  }

  // Extract token from output
  // Token may span multiple lines if terminal wraps it
  const lines = output.split("\n").map((l) => l.trim());

  // Find the line that starts with sk-ant-
  const tokenLineIdx = lines.findIndex((l) => l.startsWith("sk-ant-"));

  if (tokenLineIdx === -1) {
    return {
      success: false,
      error:
        "Could not extract token from output. " +
        "Run 'aop auth <token>' with your token to store it manually."
    };
  }

  // Collect token: first line + any continuation lines (lines with only token chars)
  const tokenParts: string[] = [lines[tokenLineIdx]!];

  for (let i = tokenLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Empty line or line with spaces = end of token
    if (line.length === 0 || line.includes(" ")) {
      break;
    }
    // Continuation must be only valid token chars
    if (/^[A-Za-z0-9_-]+$/.test(line)) {
      tokenParts.push(line);
    } else {
      break;
    }
  }

  const token = tokenParts.join("");
  await storeApiKey(token);

  return {
    success: true,
    message: `\nAuthentication successful!\nToken stored in ${AUTH_FILE}`
  };
};

/**
 * Ensures authentication is set up before running a command.
 * Returns the API key if available, or guides user through setup.
 */
export const ensureAuth = async (): Promise<string | null> => {
  const apiKey = await getStoredApiKey();
  if (apiKey) {
    // Set it in our custom env var (not ANTHROPIC_API_KEY to avoid SDK auto-read)
    process.env.AOP_AUTH_TOKEN = apiKey;
    return apiKey;
  }
  return null;
};
