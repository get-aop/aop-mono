import { EventEmitter } from "node:events";
import { type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../../types";
import { getGlobalDir } from "../global-bootstrap";
import type { ProjectRegistryEmitter } from "../interfaces/project-registry";
import {
  findProjectByPath as registryFindProjectByPath,
  getProject as registryGetProject,
  listProjects as registryListProjects,
  registerProject as registryRegisterProject,
  unregisterProject as registryUnregisterProject
} from "../project-registry";

export interface FileSystemProjectRegistryOptions {
  debounceMs?: number;
}

export class FileSystemProjectRegistry
  extends EventEmitter
  implements ProjectRegistryEmitter
{
  private watcher: FSWatcher | null = null;
  private projectsDir: string;
  private knownProjects = new Set<string>();
  private debounceTimer: Timer | null = null;
  private debounceMs: number;

  constructor(options?: FileSystemProjectRegistryOptions) {
    super();
    this.projectsDir = join(getGlobalDir(), "projects");
    this.debounceMs = options?.debounceMs ?? 100;
  }

  // Read operations

  async listProjects(): Promise<ProjectConfig[]> {
    return registryListProjects();
  }

  async getProject(name: string): Promise<ProjectConfig | null> {
    return registryGetProject(name);
  }

  async findProjectByPath(searchPath: string): Promise<ProjectConfig | null> {
    return registryFindProjectByPath(searchPath);
  }

  // Write operations

  async registerProject(path: string): Promise<ProjectConfig> {
    const project = await registryRegisterProject(path);
    this.knownProjects.add(project.name);
    this.emit("projectAdded", project);
    return project;
  }

  async unregisterProject(name: string): Promise<void> {
    await registryUnregisterProject(name);
    this.knownProjects.delete(name);
    this.emit("projectRemoved", name);
  }

  async updateProject(
    name: string,
    updates: Partial<Omit<ProjectConfig, "name">>
  ): Promise<void> {
    const project = await this.getProject(name);
    if (!project) {
      throw new Error(`Project '${name}' not found`);
    }

    const YAML = await import("yaml");
    const projectFile = join(this.projectsDir, `${name}.yaml`);

    const updatedProject: ProjectConfig = {
      ...project,
      ...updates,
      name
    };

    await Bun.write(projectFile, YAML.stringify(updatedProject));
    this.emit("projectUpdated", updatedProject);
  }

  // Lifecycle

  async start(): Promise<void> {
    const initialProjects = await this.scanProjectNames();
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
        if (err.code === "ENOENT") {
          return;
        }
        this.emit("error", err);
      });
    } catch (err) {
      this.emit("error", err as Error);
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // Private methods

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

  private async scanProjectNames(): Promise<string[]> {
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
    const currentProjects = await this.scanProjectNames();
    const currentSet = new Set(currentProjects);

    for (const name of currentProjects) {
      if (!this.knownProjects.has(name)) {
        const project = await this.getProject(name);
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
