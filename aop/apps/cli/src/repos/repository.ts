import { basename } from "node:path";
import type { Kysely } from "kysely";
import type { Database, NewRepo, Repo } from "../db/schema.ts";

export interface RepoRepository {
  create: (repo: NewRepo) => Promise<Repo>;
  getByPath: (path: string) => Promise<Repo | null>;
  getById: (id: string) => Promise<Repo | null>;
  getAll: () => Promise<Repo[]>;
  remove: (id: string) => Promise<boolean>;
}

export const createRepoRepository = (db: Kysely<Database>): RepoRepository => ({
  create: async (repo: NewRepo): Promise<Repo> => {
    return db.insertInto("repos").values(repo).returningAll().executeTakeFirstOrThrow();
  },

  getByPath: async (path: string): Promise<Repo | null> => {
    const repo = await db
      .selectFrom("repos")
      .selectAll()
      .where("path", "=", path)
      .executeTakeFirst();
    return repo ?? null;
  },

  getById: async (id: string): Promise<Repo | null> => {
    const repo = await db.selectFrom("repos").selectAll().where("id", "=", id).executeTakeFirst();
    return repo ?? null;
  },

  getAll: async (): Promise<Repo[]> => {
    return db.selectFrom("repos").selectAll().execute();
  },

  remove: async (id: string): Promise<boolean> => {
    const existing = await db
      .selectFrom("repos")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!existing) {
      return false;
    }
    await db.deleteFrom("repos").where("id", "=", id).execute();
    return true;
  },
});

export const extractRepoName = (repoPath: string): string => {
  return basename(repoPath);
};
