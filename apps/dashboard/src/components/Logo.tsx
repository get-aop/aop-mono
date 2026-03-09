interface LogoProps {
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
}

const svgSizes = {
  sm: 16,
  md: 24,
  lg: 32,
};

const sizeClasses = {
  sm: {
    wordmark: "text-sm",
  },
  md: {
    wordmark: "text-lg",
  },
  lg: {
    wordmark: "text-xl",
  },
};

export const Logo = ({ showWordmark = true, size = "md" }: LogoProps) => {
  const svgSize = svgSizes[size];
  const wordmarkClass = sizeClasses[size].wordmark;

  return (
    <div className="flex items-center gap-2">
      <svg
        width={svgSize}
        height={svgSize}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
      >
        <title>AOP Logo</title>
        <circle cx="20" cy="20" r="9" stroke="#d97706" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="3" fill="#d97706" />
        <circle cx="20" cy="4" r="2" fill="#fafaf9" />
        <circle cx="33.9" cy="28" r="2" fill="#fafaf9" />
        <circle cx="6.1" cy="28" r="2" fill="#fafaf9" />
      </svg>
      {showWordmark && (
        <span className={`font-display ${wordmarkClass} font-light tracking-wider`}>AOP</span>
      )}
    </div>
  );
};
