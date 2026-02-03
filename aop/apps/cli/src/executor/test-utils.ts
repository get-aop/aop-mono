import { mock } from "bun:test";
import type { StepCompleteResponse } from "@aop/common/protocol";
import { ClaudeCodeProvider, type RunOptions } from "@aop/llm-provider";
import type { ServerSync } from "../sync/server-sync.ts";
import { createMockServerSync } from "../sync/test-utils.ts";

export class TestClaudeCodeProvider extends ClaudeCodeProvider {
  private testCommand: string[];

  constructor(testCommand: string[]) {
    super();
    this.testCommand = testCommand;
  }

  override buildCommand(_options: RunOptions): string[] {
    return this.testCommand;
  }
}

export const createSpyServerSync = (overrides: Partial<ServerSync> = {}): ServerSync => {
  const baseMock = createMockServerSync();
  return {
    authenticate: mock(baseMock.authenticate),
    syncRepo: mock(baseMock.syncRepo),
    syncTask: mock(baseMock.syncTask),
    markTaskReady: mock(baseMock.markTaskReady),
    completeStep: mock(baseMock.completeStep),
    getTaskStatus: mock(baseMock.getTaskStatus),
    isDegraded: mock(baseMock.isDegraded),
    getQueuedReadyTasks: mock(baseMock.getQueuedReadyTasks),
    retryQueuedReadyTasks: mock(baseMock.retryQueuedReadyTasks),
    flushOfflineQueue: mock(baseMock.flushOfflineQueue),
    getOfflineQueueSize: mock(baseMock.getOfflineQueueSize),
    ...overrides,
  };
};

export const createMockCompleteStep = (response: StepCompleteResponse) =>
  mock(async (): Promise<StepCompleteResponse> => response);
