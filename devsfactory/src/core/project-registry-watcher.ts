import { EventEmitter } from "node:events";
import { type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../types";
import { getGlobalDir } from "./global-bootstrap";
import { getProject } from "./project-registry";

export interface ProjectRegistryWatcherEvents {
  projectAdded: (project: ProjectConfig) => void;
  projectRemoved: (projectName: string) => void;
  error: (error: Error) => void;
}

export class ProjectRegistryWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private projectsDir: string;
  private knownProjects = new Set<string>();
  private debounceTimer: Timer | null = null;
  private debounceMs: number;

  constructor(options?: { debounceMs?: number }) {
    super();
    this.projectsDir = join(getGlobalDir(), "projects");
    this.debounceMs = options?.debounceMs ?? 100;
  }

  async start(): Promise<void> {
    const initialProjects = await this.scanProjects();
    for (const name of initialProjects) {
      this.knownProjects.add(name);
    }

    try {
      this.watcher = watch(this.projectsDir, (_eventType, filename) => {
        if (
          filename &&
          (filename.endsWith(".yaml") || filename.endsWith(".yml"))
        ) {
          this.scheduleCheck();
        }
      });

      this.watcher.on("error", (err: NodeJS.ErrnoException) => {
        // Ignore ENOENT errors from watching deleted files - this is expected behavior
        if (err.code === "ENOENT") {
          return;
        }
        this.emit("error", err);
      });
    } catch (err) {
      this.emit("error", err as Error);
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private scheduleCheck(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.checkForChanges().catch((err) => {
        this.emit("error", err);
      });
    }, this.debounceMs);
  }

  private async scanProjects(): Promise<string[]> {
    try {
      const entries = await readdir(this.projectsDir);
      return entries
        .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
        .map((f) => f.replace(/\.ya?ml$/, ""));
    } catch {
      return [];
    }
  }

  private async checkForChanges(): Promise<void> {
    const currentProjects = await this.scanProjects();
    const currentSet = new Set(currentProjects);

    for (const name of currentProjects) {
      if (!this.knownProjects.has(name)) {
        const project = await getProject(name);
        if (project) {
          this.knownProjects.add(name);
          this.emit("projectAdded", project);
        }
      }
    }

    for (const name of this.knownProjects) {
      if (!currentSet.has(name)) {
        this.knownProjects.delete(name);
        this.emit("projectRemoved", name);
      }
    }
  }
}
