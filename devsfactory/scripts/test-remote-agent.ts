#!/usr/bin/env bun
/**
 * Test script for the distributed orchestrator.
 *
 * Usage:
 *   Terminal 1 (Server): bun scripts/test-remote-agent.ts server
 *   Terminal 2 (Agent):  bun scripts/test-remote-agent.ts agent
 */

import { EventEmitter } from "node:events";
import { AgentClient } from "../src/agent/agent-client";
import { AopServer } from "../src/core/aop-server";
import { generateSecret } from "../src/core/remote/auth";
import { configureLogger } from "../src/infra/logger";

await configureLogger();

const TEST_SECRET =
  process.env.TEST_SECRET ?? "test-secret-for-local-testing-1234567890";
const SERVER_PORT = 3333;
const SERVER_URL = `ws://localhost:${SERVER_PORT}/api/agents`;

// Minimal orchestrator mock for testing
class MockOrchestrator extends EventEmitter {
  getState() {
    return { tasks: [], plans: {}, subtasks: {} };
  }
  async getActiveAgents() {
    return [];
  }
}

const runServer = async () => {
  console.log("Starting server...");
  console.log(`Secret: ${TEST_SECRET}`);
  console.log(`Port: ${SERVER_PORT}`);
  console.log("");

  const orchestrator = new MockOrchestrator();
  const server = new AopServer(orchestrator, {
    port: SERVER_PORT,
    remoteAgentSecret: TEST_SECRET
  });

  await server.start();

  console.log(`Server running on port ${server.port}`);
  console.log(`Agent endpoint: ws://localhost:${server.port}/api/agents`);
  console.log("");
  console.log("Waiting for agents to connect...");
  console.log("Press Ctrl+C to stop");

  const dispatcher = server.getAgentDispatcher();
  if (dispatcher) {
    dispatcher.on("agentConnected", (agent) => {
      console.log(
        `\n✓ Agent connected: ${agent.agentId} (machine: ${agent.machineId})`
      );
      console.log(`  Total agents: ${dispatcher.getAgentCount()}`);
    });

    dispatcher.on("agentDisconnected", ({ agentId, reason }) => {
      console.log(`\n✗ Agent disconnected: ${agentId} (${reason})`);
      console.log(`  Total agents: ${dispatcher.getAgentCount()}`);
    });

    dispatcher.on("jobDispatched", ({ jobId, agentId }) => {
      console.log(`\n→ Job dispatched: ${jobId} to ${agentId}`);
    });

    dispatcher.on("jobCompleted", ({ jobId, agentId }) => {
      console.log(`\n✓ Job completed: ${jobId} by ${agentId}`);
    });

    dispatcher.on("jobFailed", ({ jobId, agentId, error }) => {
      console.log(`\n✗ Job failed: ${jobId} by ${agentId}: ${error}`);
    });

    dispatcher.on("jobOutput", ({ jobId, line }) => {
      if (line.trim()) {
        console.log(`  [${jobId.slice(-8)}] ${line}`);
      }
    });
  }

  // Keep running
  process.on("SIGINT", async () => {
    console.log("\nStopping server...");
    await server.stop();
    process.exit(0);
  });

  await new Promise(() => {}); // Keep alive
};

const runAgent = async () => {
  console.log("Starting agent...");
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Secret: ${TEST_SECRET}`);
  console.log("");

  const client = new AgentClient({
    serverUrl: SERVER_URL,
    secret: TEST_SECRET,
    model: "sonnet", // Use sonnet for faster/cheaper testing
    projectName: "test-project",
    repoPath: "/tmp/test-repo"
  });

  client.on("connected", ({ agentId }) => {
    console.log(`✓ Connected as ${agentId}`);
    console.log("Waiting for jobs...");
  });

  client.on("disconnected", ({ reason }) => {
    console.log(`✗ Disconnected: ${reason}`);
  });

  client.on("error", ({ error }) => {
    console.error(`Error: ${error.message}`);
  });

  client.on("jobStarted", ({ jobId, taskFolder }) => {
    console.log(`\n→ Job started: ${jobId} (${taskFolder})`);
  });

  client.on("jobCompleted", ({ jobId, exitCode }) => {
    console.log(`✓ Job completed: ${jobId} (exit: ${exitCode})`);
  });

  client.on("jobFailed", ({ jobId, error }) => {
    console.error(`✗ Job failed: ${jobId}: ${error}`);
  });

  process.on("SIGINT", () => {
    console.log("\nDisconnecting...");
    client.disconnect();
    process.exit(0);
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(
      `Failed to connect: ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }

  await new Promise(() => {}); // Keep alive
};

const runServerWithTestJob = async () => {
  console.log("Starting server with test job dispatch...");
  console.log(`Secret: ${TEST_SECRET}`);
  console.log(`Port: ${SERVER_PORT}`);
  console.log("");

  const orchestrator = new MockOrchestrator();
  const server = new AopServer(orchestrator, {
    port: SERVER_PORT,
    remoteAgentSecret: TEST_SECRET
  });

  await server.start();

  console.log(`Server running on port ${server.port}`);
  console.log(`Agent endpoint: ws://localhost:${server.port}/api/agents`);
  console.log("");

  const dispatcher = server.getAgentDispatcher();
  if (!dispatcher) {
    console.error("Dispatcher not available");
    process.exit(1);
  }

  dispatcher.on("agentConnected", async (agent) => {
    console.log(`\n✓ Agent connected: ${agent.agentId}`);
    console.log("Dispatching test job in 2 seconds...");

    await new Promise((r) => setTimeout(r, 2000));

    // Create a test job
    const testJob = {
      id: `test-job-${Date.now()}`,
      type: "implementation" as const,
      taskFolder: "test-task",
      status: "pending" as const,
      priority: 10,
      createdAt: new Date()
    };

    console.log(`\nDispatching job: ${testJob.id}`);

    try {
      const result = await dispatcher.dispatch(
        testJob,
        'Say "Hello from remote agent!" and then list the files in the current directory using the Bash tool. Keep your response brief.',
        process.cwd(),
        { model: "haiku", timeout: 120000 }
      );

      console.log(`\nJob result:`, result);
    } catch (error) {
      console.error(`\nJob error:`, error);
    }
  });

  dispatcher.on("agentDisconnected", ({ agentId, reason }) => {
    console.log(`\n✗ Agent disconnected: ${agentId} (${reason})`);
  });

  dispatcher.on("jobOutput", ({ line }) => {
    if (line.trim()) {
      console.log(`  [output] ${line}`);
    }
  });

  process.on("SIGINT", async () => {
    console.log("\nStopping server...");
    await server.stop();
    process.exit(0);
  });

  console.log("Waiting for an agent to connect...");
  console.log(
    "Run in another terminal: bun scripts/test-remote-agent.ts agent"
  );
  console.log("Press Ctrl+C to stop");

  await new Promise(() => {});
};

// Main
const command = process.argv[2];

switch (command) {
  case "server":
    await runServer();
    break;
  case "agent":
    await runAgent();
    break;
  case "test-job":
    await runServerWithTestJob();
    break;
  case "secret":
    console.log("Generated secret:", generateSecret());
    break;
  default:
    console.log(`
Usage: bun scripts/test-remote-agent.ts <command>

Commands:
  server    Start the server with remote agent support
  agent     Start an agent that connects to the server
  test-job  Start server and dispatch a test job when agent connects
  secret    Generate a new shared secret

Testing locally (basic):
  1. Terminal 1: bun scripts/test-remote-agent.ts server
  2. Terminal 2: bun scripts/test-remote-agent.ts agent

Testing with job dispatch:
  1. Terminal 1: bun scripts/test-remote-agent.ts test-job
  2. Terminal 2: bun scripts/test-remote-agent.ts agent

Environment variables:
  TEST_SECRET   Shared secret (default: test-secret-for-local-testing-1234567890)
`);
}
