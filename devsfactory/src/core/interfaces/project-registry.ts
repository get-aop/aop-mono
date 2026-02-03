import type { EventEmitter } from "node:events";
import type { ProjectConfig } from "../../types";

export interface ProjectRegistryEvents {
  projectAdded: (project: ProjectConfig) => void;
  projectRemoved: (projectName: string) => void;
  projectUpdated: (project: ProjectConfig) => void;
  error: (error: Error) => void;
}

export interface ProjectRegistry {
  // Read
  listProjects(): Promise<ProjectConfig[]>;
  getProject(name: string): Promise<ProjectConfig | null>;
  findProjectByPath(searchPath: string): Promise<ProjectConfig | null>;

  // Write
  registerProject(path: string): Promise<ProjectConfig>;
  unregisterProject(name: string): Promise<void>;
  updateProject(
    name: string,
    updates: Partial<Omit<ProjectConfig, "name">>
  ): Promise<void>;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type ProjectRegistryEmitter = ProjectRegistry & EventEmitter;
