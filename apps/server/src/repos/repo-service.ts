import type { RepoRepository } from "./repo-repository.ts";

export interface RepoService {
  syncRepo: (clientId: string, repoId: string, syncedAt: Date) => Promise<void>;
}

export const createRepoService = (repoRepo: RepoRepository): RepoService => ({
  syncRepo: async (clientId, repoId, syncedAt) => {
    await repoRepo.upsert({
      id: repoId,
      client_id: clientId,
      synced_at: syncedAt,
    });
  },
});
