import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

export interface BranchComboboxProps {
  branches: string[];
  selected: string;
  onSelect: (branch: string) => void;
  disabled: boolean;
  label?: string;
  id?: string;
  testId?: string;
}

export const BranchCombobox = ({
  branches,
  selected,
  onSelect,
  disabled,
  label = "BASE BRANCH",
  id = "branch-combobox",
  testId = "branch-combobox",
}: BranchComboboxProps) => {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selected);
  }, [selected]);

  const filtered = query
    ? branches.filter((b) => b.toLowerCase().includes(query.toLowerCase()))
    : branches;

  const exactMatch = branches.includes(query);
  const showCreate = query.trim().length > 0 && !exactMatch;
  const totalOptions = filtered.length + (showCreate ? 1 : 0);

  const commitSelection = useCallback(
    (branch: string) => {
      onSelect(branch);
      setQuery(branch);
      setIsOpen(false);
      setHighlightIndex(-1);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlightIndex((prev) => {
          const next = prev + delta;
          if (next < 0) return totalOptions - 1;
          return next >= totalOptions ? 0 : next;
        });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        resolveEnterKey(highlightIndex, filtered, showCreate, query, commitSelection);
      }
    },
    [highlightIndex, filtered, showCreate, query, commitSelection, totalOptions],
  );

  useEffect(() => {
    if (!isOpen || highlightIndex < 0) return;
    const item = listRef.current?.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, isOpen]);

  useClickOutside(inputRef, listRef, isOpen, () => {
    setIsOpen(false);
    if (query.trim() && query !== selected) {
      onSelect(query.trim());
    }
  });

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block font-mono text-[10px] text-aop-slate-dark">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setHighlightIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={branches.length > 0 ? "Search or type a branch..." : "Loading..."}
        disabled={disabled}
        autoComplete="off"
        data-testid={testId}
        className="w-full rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-1.5 font-mono text-xs text-aop-cream placeholder:text-aop-slate-dark focus:border-aop-amber focus:outline-none disabled:opacity-50"
      />

      {isOpen && totalOptions > 0 ? (
        <BranchDropdown
          ref={listRef}
          filtered={filtered}
          selected={selected}
          query={query}
          highlightIndex={highlightIndex}
          showCreate={showCreate}
          onSelect={commitSelection}
          onHighlight={setHighlightIndex}
        />
      ) : null}
    </div>
  );
};

interface BranchDropdownProps {
  filtered: string[];
  selected: string;
  query: string;
  highlightIndex: number;
  showCreate: boolean;
  onSelect: (branch: string) => void;
  onHighlight: (index: number) => void;
}

const BranchDropdown = forwardRef<HTMLDivElement, BranchDropdownProps>(
  ({ filtered, selected, query, highlightIndex, showCreate, onSelect, onHighlight }, ref) => (
    <div
      ref={ref}
      className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-aop border border-aop-charcoal bg-aop-dark shadow-lg"
    >
      {filtered.map((branch, i) => (
        <button
          key={branch}
          type="button"
          tabIndex={-1}
          onMouseDown={() => onSelect(branch)}
          onMouseEnter={() => onHighlight(i)}
          className={`flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-mono text-xs ${
            highlightIndex === i
              ? "bg-aop-charcoal text-aop-cream"
              : "text-aop-slate-light hover:bg-aop-charcoal/50"
          } ${branch === selected ? "text-aop-amber" : ""}`}
        >
          <BranchIcon />
          {branch}
          {branch === selected ? (
            <span className="ml-auto font-mono text-[10px] text-aop-slate-dark">current</span>
          ) : null}
        </button>
      ))}

      {showCreate ? (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={() => onSelect(query.trim())}
          onMouseEnter={() => onHighlight(filtered.length)}
          className={`flex w-full cursor-pointer items-center gap-2 border-x-0 border-b-0 border-t border-aop-charcoal bg-transparent px-3 py-1.5 text-left font-mono text-xs ${
            highlightIndex === filtered.length
              ? "bg-aop-charcoal text-aop-cream"
              : "text-aop-slate-light hover:bg-aop-charcoal/50"
          }`}
        >
          <PlusIcon />
          <span>
            Use "<span className="text-aop-amber">{query.trim()}</span>"
          </span>
        </button>
      ) : null}
    </div>
  ),
);

const useClickOutside = (
  inputRef: React.RefObject<HTMLElement | null>,
  listRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
) => {
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!inputRef.current?.contains(target) && !listRef.current?.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, inputRef, listRef, onClose]);
};

const resolveEnterKey = (
  highlightIndex: number,
  filtered: string[],
  showCreate: boolean,
  query: string,
  commit: (branch: string) => void,
) => {
  const highlighted = filtered[highlightIndex];
  if (highlighted !== undefined) {
    commit(highlighted);
  } else if (highlightIndex === filtered.length && showCreate) {
    commit(query.trim());
  } else if (query.trim()) {
    commit(query.trim());
  }
};

const BranchIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0"
    role="img"
    aria-label="Branch"
  >
    <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0"
    role="img"
    aria-label="Add"
  >
    <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
  </svg>
);
