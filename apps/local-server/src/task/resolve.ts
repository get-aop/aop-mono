import type { Task } from "../db/schema.ts";
import type { TaskRepository } from "./repository.ts";

export const resolveTask = async (
  taskRepository: TaskRepository,
  identifier: string,
): Promise<Task | null> => {
  return taskRepository.get(identifier);
};
