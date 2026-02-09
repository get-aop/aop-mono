interface TextInputProps {
  id?: string;
  type?: "text" | "password";
  inputMode?: "numeric" | "text";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suffix?: string;
  compact?: boolean;
  className?: string;
}

export const TextInput = ({
  id,
  type = "text",
  inputMode,
  value,
  onChange,
  placeholder,
  suffix,
  compact,
  className,
}: TextInputProps) => (
  <div className={`relative ${className ?? ""}`}>
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-aop border border-aop-charcoal bg-aop-dark py-1.5 pl-3 font-mono text-xs text-aop-cream outline-none transition-colors placeholder:text-aop-slate-dark focus:border-aop-slate-dark ${
        compact ? "w-24 pr-3 text-right" : "w-52 pr-3"
      } ${suffix ? "pr-7" : ""}`}
    />
    {suffix && (
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-aop-slate-dark">
        {suffix}
      </span>
    )}
  </div>
);
