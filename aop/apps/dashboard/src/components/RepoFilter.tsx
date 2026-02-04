interface Repo {
  id: string;
  name: string | null;
  path: string;
}

interface RepoFilterProps {
  repos: Repo[];
  selectedRepoId: string | null;
  onChange: (repoId: string | null) => void;
}

export const RepoFilter = ({ repos, selectedRepoId, onChange }: RepoFilterProps) => {
  if (repos.length === 0) return null;

  return (
    <select
      value={selectedRepoId ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="cursor-pointer rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-1.5 font-mono text-xs text-aop-cream transition-colors hover:border-aop-slate-dark focus:border-aop-amber focus:outline-none"
    >
      <option value="">All repositories</option>
      {repos.map((repo) => (
        <option key={repo.id} value={repo.id}>
          {repo.name ?? repo.path.split("/").pop()}
        </option>
      ))}
    </select>
  );
};
