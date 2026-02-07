import { getLogger, getTracerProvider } from "@aop/infra";
import { otel } from "@hono/otel";
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
import {
  createWorkflowRepository,
  type WorkflowRepository,
} from "../workflow/workflow-repository.ts";
import { authMiddleware, errorHandler } from "./middleware/index.ts";
import { auth, health, repos, steps, tasks, workflows } from "./routes/index.ts";

const logger = getLogger("api");

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
  workflowRepository: WorkflowRepository;
}

let appContext: AppContext | null = null;

export const getAppContext = (): AppContext => {
  if (!appContext) {
    throw new Error("App context not initialized");
  }
  return appContext;
};

export const createApp = (deps: ServerDependencies) => {
  const clientRepo = createClientRepository(deps.db);
  const clientService = createClientService(clientRepo);
  const repoRepo = createRepoRepository(deps.db);
  const repoService = createRepoService(repoRepo);
  const taskRepo = createTaskRepository(deps.db);
  const executionRepo = createExecutionRepository(deps.db);
  const taskService = createTaskService(taskRepo, executionRepo, repoRepo);
  const executionService = createExecutionService(deps.db);
  const workflowRepository = createWorkflowRepository(deps.db);
  appContext = {
    db: deps.db,
    clientService,
    repoService,
    taskService,
    executionService,
    workflowRepository,
  };

  const app = new Hono();

  app.use("*", otel({ tracerProvider: getTracerProvider() }));

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/health") {
      return next();
    }

    const method = c.req.method;
    const start = Date.now();
    logger.info("{method} {path}", { method, path });

    await next();

    const status = c.res.status;
    const durationMs = Date.now() - start;
    if (status >= 400) {
      logger.warn("{method} {path} → {status} ({durationMs}ms)", {
        method,
        path,
        status,
        durationMs,
      });
    } else {
      logger.info("{method} {path} → {status} ({durationMs}ms)", {
        method,
        path,
        status,
        durationMs,
      });
    }
  });

  app.route("/", health);
  app.route("/", auth);

  app.use("/repos/*", authMiddleware);
  app.use("/tasks/*", authMiddleware);
  app.use("/steps/*", authMiddleware);
  app.use("/workflows", authMiddleware);

  app.route("/", repos);
  app.route("/", tasks);
  app.route("/", steps);
  app.route("/", workflows);

  return app;
};

export const createServer = (deps: ServerDependencies) => {
  const app = createApp(deps);

  return Bun.serve({
    fetch: app.fetch,
    port: deps.port,
  });
};
