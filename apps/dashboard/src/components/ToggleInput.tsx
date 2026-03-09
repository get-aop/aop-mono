interface ToggleInputProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export const ToggleInput = ({ id, checked, onChange }: ToggleInputProps) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-10 cursor-pointer rounded-full transition-colors ${
      checked ? "bg-aop-amber" : "bg-aop-charcoal"
    }`}
  >
    <span
      className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-aop-cream transition-transform ${
        checked ? "translate-x-4" : "translate-x-0"
      }`}
    />
  </button>
);
