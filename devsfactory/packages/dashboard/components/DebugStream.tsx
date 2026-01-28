import { useEffect, useRef } from "react";

interface DebugStreamProps {
  lines: string[];
  autoScroll?: boolean;
}

export const DebugStream = ({ lines, autoScroll = true }: DebugStreamProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll on content change
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div ref={containerRef} className="debug-stream monospace pre">
      {lines.map((line, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only with no stable IDs
        <div key={idx} className="debug-line">
          {line}
        </div>
      ))}
    </div>
  );
};
