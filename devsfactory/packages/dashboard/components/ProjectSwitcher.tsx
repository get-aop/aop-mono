import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../context";

export const ProjectSwitcher = () => {
  const projects = useDashboardStore((s) => s.project.projects);
  const isGlobalMode = useDashboardStore((s) => s.project.isGlobalMode);
  const currentProject = useDashboardStore((s) => s.project.currentProject);
  const selectProject = useDashboardStore((s) => s.selectProject);
  const selectAllProjects = useDashboardStore((s) => s.selectAllProjects);
  const refreshTasks = useDashboardStore((s) => s.refreshTasks);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isGlobalMode) {
    return null;
  }

  const currentProjectData = projects.find((p) => p.name === currentProject);
  const displayName = currentProject ?? "All Projects";

  const handleProjectSelect = (projectName: string | null) => {
    if (projectName === null) {
      selectAllProjects();
    } else {
      selectProject(projectName);
    }
    setIsOpen(false);
  };

  return (
    <div className="project-switcher" ref={dropdownRef}>
      <button
        type="button"
        className="project-switcher-current"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className="project-switcher-name">{displayName}</span>
        {currentProjectData && (
          <span className="task-count-badge">
            {currentProjectData.taskCount}
          </span>
        )}
        <span className="project-switcher-arrow">{isOpen ? "▲" : "▼"}</span>
      </button>
      {currentProject && (
        <button
          type="button"
          className="refresh-btn"
          onClick={() => refreshTasks()}
          title="Refresh tasks"
        >
          ↻
        </button>
      )}

      {isOpen && (
        <div className="project-switcher-dropdown" role="listbox">
          <div
            className={`project-switcher-item ${currentProject === null ? "selected" : ""}`}
            role="option"
            tabIndex={0}
            aria-selected={currentProject === null}
            onClick={() => handleProjectSelect(null)}
            onKeyDown={(e) => e.key === "Enter" && handleProjectSelect(null)}
          >
            <span className="project-switcher-item-name">All Projects</span>
          </div>
          {projects.map((project) => (
            <div
              key={project.name}
              className={`project-switcher-item ${currentProject === project.name ? "selected" : ""}`}
              role="option"
              tabIndex={0}
              aria-selected={currentProject === project.name}
              onClick={() => handleProjectSelect(project.name)}
              onKeyDown={(e) =>
                e.key === "Enter" && handleProjectSelect(project.name)
              }
            >
              <span className="project-switcher-item-name">{project.name}</span>
              <span className="task-count-badge">{project.taskCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
