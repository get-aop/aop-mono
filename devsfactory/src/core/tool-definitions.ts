import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { IOHandler } from "./interactive-io-handler";

export const AskUserInputSchema = z.object({
  question: z.string(),
  options: z
    .array(
      z.object({
        label: z.string(),
        description: z.string()
      })
    )
    .optional(),
  multiSelect: z.boolean().optional(),
  header: z.string().optional()
});

export const ReadFileInputSchema = z.object({
  path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional()
});

export const WriteFileInputSchema = z.object({
  path: z.string(),
  content: z.string()
});

export const BashInputSchema = z.object({
  command: z.string(),
  timeout: z.number().optional()
});

export const GlobInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional()
});

export const GrepInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  include: z.string().optional()
});

export type AskUserInput = z.infer<typeof AskUserInputSchema>;
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;
export type BashInput = z.infer<typeof BashInputSchema>;
export type GlobInput = z.infer<typeof GlobInputSchema>;
export type GrepInput = z.infer<typeof GrepInputSchema>;

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "ask_user",
    description:
      "Ask the user a question and wait for their response. Use this when you need clarification or user input.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user"
        },
        options: {
          type: "array",
          description: "Optional list of choices for the user",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              description: { type: "string" }
            },
            required: ["label", "description"]
          }
        },
        multiSelect: {
          type: "boolean",
          description: "Allow multiple selections (default: false)"
        },
        header: {
          type: "string",
          description: "Optional header/category for the question"
        }
      },
      required: ["question"]
    }
  },
  {
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file content as text.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to read"
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-indexed)"
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it does not exist, overwrites if it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file to write"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "bash",
    description:
      "Execute a bash command. Returns stdout, stderr, and exit code.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute"
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000)"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "glob",
    description:
      "Find files matching a glob pattern. Returns list of matching file paths.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern to match (e.g., "**/*.ts")'
        },
        path: {
          type: "string",
          description:
            "Directory to search in (default: current working directory)"
        }
      },
      required: ["pattern"]
    }
  },
  {
    name: "grep",
    description:
      "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for"
        },
        path: {
          type: "string",
          description: "File or directory to search in"
        },
        include: {
          type: "string",
          description: 'File pattern to include (e.g., "*.ts")'
        }
      },
      required: ["pattern"]
    }
  }
];

export interface ToolExecutorOptions {
  cwd: string;
  ioHandler: IOHandler;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export type ToolExecutor = (
  name: string,
  input: unknown
) => Promise<ToolResult>;

export const createToolExecutor = (
  options: ToolExecutorOptions
): ToolExecutor => {
  const { cwd, ioHandler } = options;

  return async (name: string, input: unknown): Promise<ToolResult> => {
    try {
      switch (name) {
        case "ask_user":
          return executeAskUser(input, ioHandler);
        case "read_file":
          return executeReadFile(input);
        case "write_file":
          return executeWriteFile(input);
        case "bash":
          return executeBash(input, cwd);
        case "glob":
          return executeGlob(input, cwd);
        case "grep":
          return executeGrep(input, cwd);
        default:
          return {
            success: false,
            output: "",
            error: `Unknown tool: ${name}`
          };
      }
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err)
      };
    }
  };
};

const executeAskUser = async (
  input: unknown,
  ioHandler: IOHandler
): Promise<ToolResult> => {
  const parsed = AskUserInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: "",
      error: `Invalid ask_user input: ${parsed.error.message}`
    };
  }

  const { question, options, multiSelect, header } = parsed.data;

  const response = await ioHandler.askUser(question, {
    choices: options,
    multiSelect,
    header
  });

  return {
    success: true,
    output: response
  };
};

const executeReadFile = async (input: unknown): Promise<ToolResult> => {
  const parsed = ReadFileInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: "",
      error: `Invalid read_file input: ${parsed.error.message}`
    };
  }

  const { path, offset, limit } = parsed.data;

  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return {
        success: false,
        output: "",
        error: `File not found: ${path}`
      };
    }

    const content = await file.text();
    let lines = content.split("\n");

    if (offset !== undefined && offset > 0) {
      lines = lines.slice(offset - 1);
    }

    if (limit !== undefined && limit > 0) {
      lines = lines.slice(0, limit);
    }

    const startLine = offset ?? 1;
    const numberedLines = lines.map(
      (line, i) => `${String(startLine + i).padStart(6, " ")}\t${line}`
    );

    return {
      success: true,
      output: numberedLines.join("\n")
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

const executeWriteFile = async (input: unknown): Promise<ToolResult> => {
  const parsed = WriteFileInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: "",
      error: `Invalid write_file input: ${parsed.error.message}`
    };
  }

  const { path, content } = parsed.data;

  try {
    await Bun.write(path, content);
    return {
      success: true,
      output: `Successfully wrote ${content.length} bytes to ${path}`
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

const executeBash = async (
  input: unknown,
  cwd: string
): Promise<ToolResult> => {
  const parsed = BashInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: "",
      error: `Invalid bash input: ${parsed.error.message}`
    };
  }

  const { command, timeout = 120000 } = parsed.data;

  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe"
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    const resultPromise = (async () => {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text()
      ]);
      await proc.exited;
      return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
    })();

    const { stdout, stderr, exitCode } = await Promise.race([
      resultPromise,
      timeoutPromise
    ]);

    let output = stdout;
    if (stderr) {
      output += stderr ? `\n[stderr]\n${stderr}` : "";
    }
    if (exitCode !== 0) {
      output += `\n[exit code: ${exitCode}]`;
    }

    return {
      success: exitCode === 0,
      output,
      error: exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Failed to execute command: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

const executeGlob = async (
  input: unknown,
  cwd: string
): Promise<ToolResult> => {
  const parsed = GlobInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: "",
      error: `Invalid glob input: ${parsed.error.message}`
    };
  }

  const { pattern, path: searchPath } = parsed.data;
  const basePath = searchPath ?? cwd;

  try {
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];

    for await (const match of glob.scan({ cwd: basePath })) {
      matches.push(match);
    }

    return {
      success: true,
      output: matches.length > 0 ? matches.join("\n") : "No matches found"
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Glob failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};

const executeGrep = async (
  input: unknown,
  cwd: string
): Promise<ToolResult> => {
  const parsed = GrepInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      output: "",
      error: `Invalid grep input: ${parsed.error.message}`
    };
  }

  const { pattern, path: searchPath, include } = parsed.data;

  const args = ["rg", "--line-number", "--no-heading"];
  if (include) {
    args.push("--glob", include);
  }
  args.push(pattern);
  if (searchPath) {
    args.push(searchPath);
  }

  try {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe"
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ]);
    await proc.exited;

    if (proc.exitCode === 1 && !stdout && !stderr) {
      return {
        success: true,
        output: "No matches found"
      };
    }

    if (proc.exitCode !== 0 && proc.exitCode !== 1) {
      return {
        success: false,
        output: "",
        error: stderr || `grep exited with code ${proc.exitCode}`
      };
    }

    return {
      success: true,
      output: stdout || "No matches found"
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      error: `Grep failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
};
