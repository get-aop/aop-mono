import { useCallback, useEffect, useState } from "react";
import { fetchChangeFile, fetchChangeFiles } from "../api/client";
import type { Task } from "../types";
import { FileTreeFlyout } from "./FileTreeFlyout";
import { MarkdownViewer } from "./MarkdownViewer";

const sortFilesTasksFirst = (files: string[]): string[] => {
  const sorted = [...files];
  sorted.sort((a, b) => {
    const priority = ["task.md", "plan.md"];
    const aPriority = priority.indexOf(a);
    const bPriority = priority.indexOf(b);
    if (aPriority !== -1 || bPriority !== -1) {
      if (aPriority === -1) return 1;
      if (bPriority === -1) return -1;
      return aPriority - bPriority;
    }
    return a.localeCompare(b);
  });
  return sorted;
};

interface SpecsTabProps {
  task: Task;
}

export const SpecsTab = ({ task }: SpecsTabProps) => {
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState("task.md");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchChangeFiles(task.repoId, task.id)
      .then((f) => {
        const nextFiles = sortFilesTasksFirst(f);
        setFiles(nextFiles);
        if (nextFiles.length > 0 && !nextFiles.includes(activeFile)) {
          setActiveFile(nextFiles[0] ?? "task.md");
        }
      })
      .catch(() => setFiles([]));
  }, [activeFile, task.repoId, task.id]);

  const loadFile = useCallback(
    (path: string) => {
      setLoading(true);
      setError(null);
      fetchChangeFile(task.repoId, task.id, path)
        .then((c) => {
          setContent(c);
          setLoading(false);
        })
        .catch(() => {
          setError("Failed to load file");
          setContent(null);
          setLoading(false);
        });
    },
    [task.repoId, task.id],
  );

  useEffect(() => {
    loadFile(activeFile);
  }, [activeFile, loadFile]);

  return (
    <div className="relative flex flex-1 flex-col min-h-0" data-testid="specs-tab">
      <div className="absolute -left-10 top-0.5">
        <FileTreeFlyout files={files} activeFile={activeFile} onSelectFile={setActiveFile} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="mb-1 shrink-0">
          <span className="font-mono text-xs text-aop-slate-dark">{activeFile}</span>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <span className="font-mono text-xs text-aop-slate-dark">Loading...</span>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <span className="font-mono text-xs text-aop-blocked">{error}</span>
            </div>
          ) : content !== null ? (
            <MarkdownViewer content={content} />
          ) : null}
        </div>
      </div>
    </div>
  );
};
