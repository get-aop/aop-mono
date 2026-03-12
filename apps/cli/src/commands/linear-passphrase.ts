import * as readline from "node:readline";
import { Writable } from "node:stream";

class SilentOutput extends Writable {
  private muted = false;

  constructor(private readonly target: NodeJS.WriteStream) {
    super();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  override _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) {
      this.target.write(chunk, encoding);
    }
    callback();
  }
}

export const promptForPassphrase = async (label = "Linear passphrase"): Promise<string> => {
  const output = new SilentOutput(process.stdout);
  const rl = readline.createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });

  process.stdout.write(`${label}: `);
  output.setMuted(true);

  try {
    return await new Promise<string>((resolve) => {
      rl.question("", (answer) => resolve(answer.trim()));
    });
  } finally {
    output.setMuted(false);
    process.stdout.write("\n");
    rl.close();
  }
};
