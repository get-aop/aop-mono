interface LogoProps {
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: {
    orchestrator: "h-1.5 w-1.5",
    agent: "h-1 w-1",
    gap: "gap-0.5",
    wordmark: "text-sm",
  },
  md: {
    orchestrator: "h-2 w-2",
    agent: "h-1.5 w-1.5",
    gap: "gap-0.5",
    wordmark: "text-lg",
  },
  lg: {
    orchestrator: "h-3 w-3",
    agent: "h-2 w-2",
    gap: "gap-1",
    wordmark: "text-xl",
  },
};

export const Logo = ({ showWordmark = true, size = "md" }: LogoProps) => {
  const classes = sizeClasses[size];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <div className={`${classes.orchestrator} rounded-full bg-aop-amber`} />
        <div className={`flex ${classes.gap}`}>
          <div className={`${classes.agent} rounded-full bg-aop-cream`} />
          <div className={`${classes.agent} rounded-full bg-aop-cream`} />
          <div className={`${classes.agent} rounded-full bg-aop-cream`} />
        </div>
      </div>
      {showWordmark && (
        <span className={`font-display ${classes.wordmark} font-light tracking-wider`}>AOP</span>
      )}
    </div>
  );
};
