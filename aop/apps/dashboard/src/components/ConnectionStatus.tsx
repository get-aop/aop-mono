import { useEffect, useState } from "react";
import type { ConnectionState } from "../types";
import { workingStatuses } from "./workingStatuses";

interface ConnectionStatusProps {
  state: ConnectionState;
}

const CogIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className="h-4 w-4 animate-spin-slow"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.295-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      clipRule="evenodd"
    />
  </svg>
);

export const ConnectionStatus = ({ state }: ConnectionStatusProps) => {
  const [statusIndex, setStatusIndex] = useState(() =>
    Math.floor(Math.random() * workingStatuses.length),
  );

  useEffect(() => {
    if (state !== "working") return;

    const interval = setInterval(() => {
      setStatusIndex(Math.floor(Math.random() * workingStatuses.length));
    }, 3000);

    return () => clearInterval(interval);
  }, [state]);

  if (state === "disconnected") {
    return (
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 rounded-full bg-aop-slate-dark opacity-50" />
      </div>
    );
  }

  if (state === "idle") {
    return (
      <div className="flex items-center">
        <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-aop-amber" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-aop-amber">
      <CogIcon />
      <span className="shimmer font-mono text-xs">{workingStatuses[statusIndex]}</span>
    </div>
  );
};
