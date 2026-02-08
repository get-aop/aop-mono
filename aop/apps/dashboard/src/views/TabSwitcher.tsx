export type DetailTab = "specs" | "logs";

interface TabSwitcherProps {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  isWorking: boolean;
}

export const TabSwitcher = ({ activeTab, onTabChange, isWorking }: TabSwitcherProps) => {
  const tabs: { id: DetailTab; label: string }[] = [
    { id: "specs", label: "Specs" },
    { id: "logs", label: "Logs" },
  ];

  return (
    <div className="flex shrink-0 gap-1 border-b border-aop-charcoal" data-testid="tab-switcher">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-testid={`tab-${tab.id}`}
          onClick={() => onTabChange(tab.id)}
          className={`relative -mb-px cursor-pointer px-3 py-1.5 font-mono text-xs transition-colors ${
            activeTab === tab.id
              ? "border-b border-aop-amber text-aop-cream"
              : "text-aop-slate-dark hover:text-aop-slate-light"
          }`}
        >
          <span className="flex items-center gap-1.5">
            {tab.label}
            {tab.id === "logs" && isWorking && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-aop-working pulse"
                data-testid="live-indicator"
              />
            )}
          </span>
        </button>
      ))}
    </div>
  );
};
