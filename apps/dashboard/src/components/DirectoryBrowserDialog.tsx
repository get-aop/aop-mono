import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, listDirectories } from "../api/client";

interface DirectoryBrowserDialogProps {
  open: boolean;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

export const DirectoryBrowserDialog = ({
  open,
  onSelect,
  onCancel,
}: DirectoryBrowserDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [currentPath, setCurrentPath] = useState<string>("");
  const [directories, setDirectories] = useState<string[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");

  const fetchDirectories = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDirectories(path);
      setCurrentPath(result.path);
      setDirectories(result.directories);
      setParentPath(result.parent);
      setIsGitRepo(result.isGitRepo);
      setPathInput(result.path);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to list directories");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      fetchDirectories();
    } else {
      dialog.close();
      setCurrentPath("");
      setDirectories([]);
      setParentPath(null);
      setIsGitRepo(false);
      setError(null);
      setPathInput("");
    }
  }, [open, fetchDirectories]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onCancel]);

  const handleDirectoryClick = (dirName: string) => {
    const newPath = currentPath === "/" ? `/${dirName}` : `${currentPath}/${dirName}`;
    fetchDirectories(newPath);
  };

  const handleParentClick = () => {
    if (parentPath) {
      fetchDirectories(parentPath);
    }
  };

  const handlePathInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) {
      fetchDirectories(pathInput.trim());
    }
  };

  const handleSelect = () => {
    onSelect(currentPath);
  };

  return (
    <dialog
      ref={dialogRef}
      className="rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-0 backdrop:bg-black/60"
    >
      <div className="flex w-[480px] flex-col">
        <div className="border-b border-aop-charcoal p-4">
          <h2 className="font-body text-base font-medium text-aop-cream">Select Repository</h2>
          <p className="mt-1 font-body text-xs text-aop-slate-light">
            Navigate to a git repository directory
          </p>
        </div>

        <form onSubmit={handlePathInputSubmit} className="border-b border-aop-charcoal p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="Enter path..."
              className="flex-1 rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-1.5 font-mono text-xs text-aop-cream placeholder:text-aop-slate-dark focus:border-aop-amber focus:outline-none"
            />
            <button
              type="submit"
              className="cursor-pointer rounded-aop border border-aop-charcoal px-3 py-1.5 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
            >
              Go
            </button>
          </div>
        </form>

        <div className="h-64 overflow-y-auto">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <span className="font-mono text-xs text-aop-slate-dark">Loading...</span>
            </div>
          )}

          {error && (
            <div className="flex h-full items-center justify-center">
              <span className="font-mono text-xs text-aop-blocked">{error}</span>
            </div>
          )}

          {!loading && !error && (
            <ul className="p-2">
              {parentPath !== null && (
                <li>
                  <button
                    type="button"
                    onClick={handleParentClick}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-aop px-3 py-2 text-left font-mono text-xs text-aop-slate-light transition-colors hover:bg-aop-charcoal hover:text-aop-cream"
                  >
                    <span className="text-aop-slate-dark">..</span>
                    <span className="text-aop-slate-dark">(parent directory)</span>
                  </button>
                </li>
              )}
              {directories.map((dir) => (
                <li key={dir}>
                  <button
                    type="button"
                    onClick={() => handleDirectoryClick(dir)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-aop px-3 py-2 text-left font-mono text-xs text-aop-cream transition-colors hover:bg-aop-charcoal"
                  >
                    <span className="text-aop-amber">/</span>
                    <span>{dir}</span>
                  </button>
                </li>
              ))}
              {directories.length === 0 && parentPath !== null && (
                <li className="px-3 py-2 font-mono text-xs text-aop-slate-dark">
                  No subdirectories
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-aop-charcoal p-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="max-w-[240px] truncate font-mono text-xs text-aop-slate-light">
              {currentPath}
            </span>
            {isGitRepo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-aop-success/15 px-2 py-0.5 animate-[fadeIn_0.2s_ease-out]">
                <svg
                  className="h-3 w-3 text-aop-success"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  role="img"
                  aria-label="Git repository"
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                <span className="font-mono text-[10px] font-medium tracking-wide text-aop-success">
                  git
                </span>
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSelect}
              disabled={loading || !currentPath}
              className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              Select
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
};
