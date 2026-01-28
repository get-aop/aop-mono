import { useState } from "react";

export interface DiffViewerProps {
  diff: string | null;
  loading: boolean;
  error: string | null;
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: "add" | "del" | "context" | "hunk";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

const parseDiff = (diff: string): DiffFile[] => {
  const files: DiffFile[] = [];
  const fileChunks = diff.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split("\n");
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const path = headerMatch[2];
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let additions = 0;
    let deletions = 0;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const line of lines.slice(1)) {
      if (line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -(\d+)/);
        oldLineNum = hunkMatch ? parseInt(hunkMatch[1], 10) : 0;
        const newMatch = line.match(/\+(\d+)/);
        newLineNum = newMatch ? parseInt(newMatch[1], 10) : 0;

        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        currentHunk.lines.push({ type: "hunk", content: line });
      } else if (currentHunk) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          currentHunk.lines.push({
            type: "add",
            content: line.slice(1),
            newLineNum: newLineNum++
          });
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          currentHunk.lines.push({
            type: "del",
            content: line.slice(1),
            oldLineNum: oldLineNum++
          });
          deletions++;
        } else if (line.startsWith(" ")) {
          currentHunk.lines.push({
            type: "context",
            content: line.slice(1),
            oldLineNum: oldLineNum++,
            newLineNum: newLineNum++
          });
        }
      }
    }

    files.push({ path, hunks, additions, deletions });
  }

  return files;
};

const getLineNumbers = (line: DiffLine): [number | string, number | string] => {
  switch (line.type) {
    case "add":
      return ["", line.newLineNum ?? ""];
    case "del":
      return [line.oldLineNum ?? "", ""];
    case "context":
      return [line.oldLineNum ?? "", line.newLineNum ?? ""];
    default:
      return ["", ""];
  }
};

const DiffFileSection = ({ file }: { file: DiffFile }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`diff-file ${collapsed ? "collapsed" : ""}`}>
      <div className="diff-file-header">
        <button
          type="button"
          className="diff-file-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <span className="diff-file-path">{file.path}</span>
        <span className="diff-file-stats">
          <span className="diff-add-count">+{file.additions}</span>
          <span className="diff-del-count">-{file.deletions}</span>
        </span>
      </div>
      {!collapsed && (
        <div className="diff-file-content">
          {file.hunks.map((hunk, hunkIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hunks are append-only from parsed diff
            <div key={hunkIdx} className="diff-hunk">
              {hunk.lines.map((line, lineIdx) => {
                const [oldNum, newNum] = getLineNumbers(line);
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only from parsed diff
                  <div key={lineIdx} className={`diff-line diff-${line.type}`}>
                    <span className="diff-line-num">{oldNum}</span>
                    <span className="diff-line-num">{newNum}</span>
                    <span className="diff-line-content">{line.content}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const DiffViewer = ({ diff, loading, error }: DiffViewerProps) => {
  if (loading) {
    return (
      <div className="diff-viewer diff-loading">
        <span>Loading diff...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diff-viewer diff-error">
        <span>{error}</span>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="diff-viewer diff-empty">
        <span>No changes</span>
      </div>
    );
  }

  const files = parseDiff(diff);
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="diff-viewer">
      <div className="diff-stats">
        <span className="diff-add-count">+{totalAdditions}</span>
        <span className="diff-del-count">-{totalDeletions}</span>
        <span className="diff-file-count">{files.length} file(s)</span>
      </div>
      <div className="diff-files">
        {files.map((file) => (
          <DiffFileSection key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
};
