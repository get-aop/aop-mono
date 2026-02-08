interface TaskProgressProps {
  completed: number;
  total: number;
}

export const TaskProgress = ({ completed, total }: TaskProgressProps) => {
  const percent = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="flex items-center gap-1.5" data-testid="task-progress">
      <span className="font-mono text-[10px] text-aop-slate-light">
        {completed}/{total}
      </span>
      <div className="h-1 w-[60px] rounded-full bg-aop-charcoal">
        <div
          className="h-1 rounded-full bg-aop-success transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
