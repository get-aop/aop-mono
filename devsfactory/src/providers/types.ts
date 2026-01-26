export interface CommandOptions {
  prompt: string;
  cwd: string;
  extraArgs?: string[];
}

export interface LLMProvider {
  readonly name: string;
  buildCommand(options: CommandOptions): string[];
  isAvailable(): Promise<boolean>;
}
