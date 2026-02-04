import { useEffect, useRef } from "react";

export interface LogLine {
  type: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

interface LogViewerProps {
  lines: LogLine[];
  autoScroll?: boolean;
}

export const LogViewer = ({ lines, autoScroll = true }: LogViewerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const linesCount = lines.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: linesCount triggers scroll on new lines
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [linesCount, autoScroll]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto rounded-aop bg-aop-black p-4 font-mono text-xs"
      data-testid="log-viewer"
    >
      {lines.length === 0 ? (
        <span className="text-aop-slate-dark">Waiting for logs...</span>
      ) : (
        lines.map((line, index) => (
          <div
            key={`${line.timestamp}-${index}`}
            className={`whitespace-pre-wrap break-all ${
              line.type === "stderr" ? "text-aop-blocked" : "text-aop-cream"
            }`}
          >
            {line.content}
          </div>
        ))
      )}
    </div>
  );
};
