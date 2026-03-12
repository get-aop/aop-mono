import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { RepoRepository } from "../../repo/repository.ts";
import type { TaskRepository } from "../../task/repository.ts";
import { toTaskSlug } from "../../task-docs/scaffold.ts";
import { parseTaskDoc, writeTaskDoc } from "../../task-docs/task.ts";
import type { TaskDocFrontmatter } from "../../task-docs/types.ts";
import type { LinearStore } from "./store.ts";
import type { LinearResolvedIssue } from "./types.ts";

export interface LinearImportRecord {
  taskId: string;
  ref: string;
  changePath: string;
  requested: boolean;
  dependencyImported: boolean;
}

export interface LinearImportFailure {
  ref: string;
  error: string;
}

export interface LinearImportResult {
  imported: LinearImportRecord[];
  failures: LinearImportFailure[];
}

interface CreateLinearImporterOptions {
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
  linearStore: LinearStore;
  resolveIssuesByRefs(refs: string[]): Promise<LinearResolvedIssue[]>;
}

export const createLinearImporter = (options: CreateLinearImporterOptions) => ({
  importIssues: async (params: {
    repoId: string;
    issues: LinearResolvedIssue[];
  }): Promise<LinearImportResult> => {
    const repo = await getRepoOrThrow(options.repoRepository, params.repoId);
    const requestedByRef = new Map(params.issues.map((issue) => [issue.ref, issue]));
    const { failures, importedByRef } = await resolveImportGraphs(params.issues, options);

    if (importedByRef.size === 0) {
      return { imported: [], failures };
    }

    const { importedRecords, taskIdsBySourceId } = await writeImportedTasks({
      repoId: params.repoId,
      repoPath: repo.path,
      importedByRef,
      requestedByRef,
      linearStore: options.linearStore,
      taskRepository: options.taskRepository,
    });

    await persistLinkage({
      repoId: params.repoId,
      importedByRef,
      importedRecords,
      linearStore: options.linearStore,
      taskIdsBySourceId,
    });

    return {
      imported: orderImportedRecords(importedRecords, params.issues, requestedByRef),
      failures,
    };
  },
});

const getRepoOrThrow = async (repoRepository: RepoRepository, repoId: string) => {
  const repo = await repoRepository.getById(repoId);
  if (!repo) {
    throw new Error(`Repo not found: ${repoId}`);
  }
  return repo;
};

const resolveImportGraphs = async (
  issues: LinearResolvedIssue[],
  options: Pick<CreateLinearImporterOptions, "resolveIssuesByRefs">,
): Promise<{
  failures: LinearImportFailure[];
  importedByRef: Map<string, LinearResolvedIssue>;
}> => {
  const importedByRef = new Map<string, LinearResolvedIssue>();
  const failures: LinearImportFailure[] = [];

  for (const issue of issues) {
    try {
      const graph = await collectIssueGraph(issue, options.resolveIssuesByRefs);
      for (const [ref, resolvedIssue] of graph) {
        importedByRef.set(ref, resolvedIssue);
      }
    } catch (error) {
      failures.push({
        ref: issue.ref,
        error: error instanceof Error ? error.message : "Failed to import Linear issue",
      });
    }
  }

  return { failures, importedByRef };
};

const writeImportedTasks = async (params: {
  repoId: string;
  repoPath: string;
  importedByRef: Map<string, LinearResolvedIssue>;
  requestedByRef: Map<string, LinearResolvedIssue>;
  linearStore: LinearStore;
  taskRepository: TaskRepository;
}): Promise<{
  importedRecords: Map<string, LinearImportRecord>;
  taskIdsBySourceId: Map<string, string>;
}> => {
  const importedRecords = new Map<string, LinearImportRecord>();
  const taskIdsBySourceId = new Map<string, string>();

  for (const issue of params.importedByRef.values()) {
    const requested = params.requestedByRef.has(issue.ref);
    const record = await writeImportedTask({
      repoId: params.repoId,
      repoPath: params.repoPath,
      issue,
      requested,
      linearStore: params.linearStore,
      taskRepository: params.taskRepository,
    });
    importedRecords.set(issue.ref, record);
    taskIdsBySourceId.set(issue.id, record.taskId);
  }

  await params.taskRepository.refresh();

  return { importedRecords, taskIdsBySourceId };
};

const persistLinkage = async (params: {
  repoId: string;
  importedByRef: Map<string, LinearResolvedIssue>;
  importedRecords: Map<string, LinearImportRecord>;
  linearStore: LinearStore;
  taskIdsBySourceId: Map<string, string>;
}): Promise<void> => {
  for (const issue of params.importedByRef.values()) {
    const record = params.importedRecords.get(issue.ref);
    if (!record) {
      continue;
    }

    await params.linearStore.upsertTaskSource({
      taskId: record.taskId,
      repoId: params.repoId,
      externalId: issue.id,
      externalRef: issue.ref,
      externalUrl: issue.url,
      titleSnapshot: issue.title,
    });
    await params.linearStore.replaceTaskDependencies(
      record.taskId,
      issue.blocks
        .map((blocker) => params.taskIdsBySourceId.get(blocker.id))
        .filter((taskId): taskId is string => typeof taskId === "string"),
    );
  }
};

const orderImportedRecords = (
  importedRecords: Map<string, LinearImportRecord>,
  requestedIssues: LinearResolvedIssue[],
  requestedByRef: Map<string, LinearResolvedIssue>,
): LinearImportRecord[] => {
  const orderedRefs = [
    ...requestedIssues.map((issue) => issue.ref),
    ...[...importedRecords.keys()]
      .filter((ref) => !requestedByRef.has(ref))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return orderedRefs.flatMap((ref) => {
    const record = importedRecords.get(ref);
    return record ? [record] : [];
  });
};

const collectIssueGraph = async (
  rootIssue: LinearResolvedIssue,
  resolveIssuesByRefs: (refs: string[]) => Promise<LinearResolvedIssue[]>,
): Promise<Map<string, LinearResolvedIssue>> => {
  const graph = new Map<string, LinearResolvedIssue>([[rootIssue.ref, rootIssue]]);

  while (true) {
    const missingRefs = [...graph.values()]
      .flatMap((issue) => issue.blocks.map((blocker) => blocker.ref))
      .filter((ref) => !graph.has(ref));

    if (missingRefs.length === 0) {
      return graph;
    }

    const uniqueRefs = [...new Set(missingRefs)];
    const resolvedIssues = await resolveIssuesByRefs(uniqueRefs);
    const resolvedByRef = new Map(resolvedIssues.map((issue) => [issue.ref, issue]));
    const unresolvedRefs = uniqueRefs.filter((ref) => !resolvedByRef.has(ref));

    if (unresolvedRefs.length > 0) {
      throw new Error(`Missing Linear blockers: ${unresolvedRefs.join(", ")}`);
    }

    for (const issue of resolvedIssues) {
      graph.set(issue.ref, issue);
    }
  }
};

const writeImportedTask = async (params: {
  repoId: string;
  repoPath: string;
  issue: LinearResolvedIssue;
  requested: boolean;
  linearStore: LinearStore;
  taskRepository: TaskRepository;
}): Promise<LinearImportRecord> => {
  const existingSource = await params.linearStore.getTaskSourceByExternalId(
    params.repoId,
    params.issue.id,
  );
  const taskId = existingSource?.task_id ?? buildLinearTaskId(params.repoId, params.issue.id);
  const existingTask = await params.taskRepository.get(taskId);
  const changePath =
    existingTask?.change_path ??
    join(aopPaths.relativeTaskDocs(), toTaskSlug(`${params.issue.ref} ${params.issue.title}`));
  const taskFilePath = join(params.repoPath, changePath, "task.md");
  const existingDoc = existingTask ? await parseTaskDoc(taskFilePath) : null;

  await mkdir(join(params.repoPath, changePath), { recursive: true });

  const frontmatter: TaskDocFrontmatter = {
    id: taskId,
    title: params.issue.title,
    status: existingDoc?.status ?? TaskStatus.DRAFT,
    created: existingDoc?.createdAt ?? new Date().toISOString(),
    changePath,
    source: {
      provider: "linear",
      id: params.issue.id,
      ref: params.issue.ref,
      url: params.issue.url,
    },
    dependencySources: params.issue.blocks.map((blocker) => ({
      provider: "linear",
      id: blocker.id,
      ref: blocker.ref,
    })),
    dependencyImported: !params.requested,
  };

  await writeTaskDoc(taskFilePath, frontmatter, buildImportedTaskBody(params.issue));

  return {
    taskId,
    ref: params.issue.ref,
    changePath,
    requested: params.requested,
    dependencyImported: !params.requested,
  };
};

const buildLinearTaskId = (repoId: string, externalId: string): string =>
  `task_${createHash("sha1").update(`${repoId}:linear:${externalId}`).digest("hex").slice(0, 12)}`;

const buildImportedTaskBody = (issue: LinearResolvedIssue): string =>
  [
    "",
    "## Description",
    `Imported from Linear ${issue.ref}`,
    "",
    "## Requirements",
    `- Review ${issue.url}`,
    "",
    "## Acceptance Criteria",
    `- [ ] Match the intent of ${issue.ref}`,
    "",
  ].join("\n");
