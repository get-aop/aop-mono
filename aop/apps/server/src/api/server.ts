import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createClientRepository } from "../clients/client-repository.ts";
import { type ClientService, createClientService } from "../clients/client-service.ts";
import type { Database } from "../db/schema.ts";
import { createExecutionRepository } from "../executions/execution-repository.ts";
import { createExecutionService, type ExecutionService } from "../executions/index.ts";
import { createRepoRepository } from "../repos/repo-repository.ts";
import { createRepoService, type RepoService } from "../repos/repo-service.ts";
import { createTaskRepository } from "../tasks/task-repository.ts";
import { createTaskService, type TaskService } from "../tasks/task-service.ts";
import { authMiddleware, errorHandler } from "./middleware/index.ts";
import { auth, health, repos, steps, tasks } from "./routes/index.ts";

export interface ServerDependencies {
  db: Kysely<Database>;
  port: number;
}

export interface AppContext {
  db: Kysely<Database>;
  clientService: ClientService;
  repoService: RepoService;
  taskService: TaskService;
  executionService: ExecutionService;
}

let appContext: AppContext | null = null;

export const getAppContext = (): AppContext => {
  if (!appContext) {
    throw new Error("App context not initialized");
  }
  return appContext;
};

export const createServer = (deps: ServerDependencies) => {
  const clientRepo = createClientRepository(deps.db);
  const clientService = createClientService(clientRepo);
  const repoRepo = createRepoRepository(deps.db);
  const repoService = createRepoService(repoRepo);
  const taskRepo = createTaskRepository(deps.db);
  const executionRepo = createExecutionRepository(deps.db);
  const taskService = createTaskService(taskRepo, executionRepo, repoRepo);
  const executionService = createExecutionService(deps.db);
  appContext = { db: deps.db, clientService, repoService, taskService, executionService };

  const app = new Hono();

  app.onError(errorHandler);

  app.route("/", health);
  app.route("/", auth);

  app.use("/repos/*", authMiddleware);
  app.use("/tasks/*", authMiddleware);
  app.use("/steps/*", authMiddleware);

  app.route("/", repos);
  app.route("/", tasks);
  app.route("/", steps);

  return Bun.serve({
    fetch: app.fetch,
    port: deps.port,
  });
};
