import { basename } from "node:path";
import { createCrudHelpers } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database, NewRepo, Repo } from "../db/schema.ts";

export interface RepoRepository {
  create: (repo: NewRepo) => Promise<Repo>;
  getByPath: (path: string) => Promise<Repo | null>;
  getById: (id: string) => Promise<Repo | null>;
  getAll: () => Promise<Repo[]>;
  remove: (id: string) => Promise<boolean>;
}

export const createRepoRepository = (db: Kysely<Database>): RepoRepository => {
  const { findById, create, listAll, deleteById } = createCrudHelpers(db, "repos");

  return {
    create: async (repo: NewRepo): Promise<Repo> => create(repo),

    getByPath: async (path: string): Promise<Repo | null> => {
      const repo = await db
        .selectFrom("repos")
        .selectAll()
        .where("path", "=", path)
        .executeTakeFirst();
      return repo ?? null;
    },

    getById: async (id: string): Promise<Repo | null> => findById(id),

    getAll: async (): Promise<Repo[]> => listAll(),

    remove: async (id: string): Promise<boolean> => deleteById(id),
  };
};

export const extractRepoName = (repoPath: string): string => {
  return basename(repoPath);
};
