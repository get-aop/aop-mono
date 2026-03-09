import { useCallback, useMemo, useRef, useState } from "react";

interface FileTreeFlyoutProps {
  files: string[];
  activeFile: string;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

const insertPart = (
  current: TreeNode[],
  name: string,
  path: string,
  filePath: string,
  isFile: boolean,
): TreeNode[] => {
  const found = current.find((n) => n.name === name);
  if (found) return found.children;
  const node: TreeNode = { name, path: isFile ? filePath : path, children: [] };
  current.push(node);
  return node.children;
};

const buildTree = (files: string[]): TreeNode[] => {
  const root: TreeNode[] = [];

  for (const filePath of files) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i] as string;
      const path = parts.slice(0, i + 1).join("/");
      current = insertPart(current, name, path, filePath, i === parts.length - 1);
    }
  }

  return root;
};

const FolderIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0"
    role="img"
    aria-label="Folder"
  >
    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
  </svg>
);

const FileIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0"
    role="img"
    aria-label="File"
  >
    <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
  </svg>
);

const TreeItem = ({
  node,
  activeFile,
  onSelect,
  depth,
}: {
  node: TreeNode;
  activeFile: string;
  onSelect: (path: string) => void;
  depth: number;
}) => {
  const isFolder = node.children.length > 0;
  const isActive = !isFolder && node.path === activeFile;

  return (
    <>
      <button
        type="button"
        onClick={() => !isFolder && onSelect(node.path)}
        className={`flex w-full items-center gap-1.5 rounded-aop px-2 py-1 text-left font-mono text-[11px] transition-colors ${
          isActive
            ? "bg-aop-amber/10 text-aop-amber"
            : isFolder
              ? "text-aop-slate-dark"
              : "cursor-pointer text-aop-slate-light hover:bg-aop-charcoal hover:text-aop-cream"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        data-testid={isFolder ? `folder-${node.name}` : `file-${node.path}`}
      >
        {isFolder ? <FolderIcon /> : <FileIcon />}
        {node.name}
      </button>
      {isFolder &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            activeFile={activeFile}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </>
  );
};

export const FileTreeFlyout = ({ files, activeFile, onSelectFile }: FileTreeFlyoutProps) => {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const tree = useMemo(() => buildTree(files), [files]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (path: string) => {
    onSelectFile(path);
    setOpen(false);
  };

  const openPanel = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPanelPos({ top: rect.top, left: rect.right + 6 });
    setOpen(true);
  }, []);

  return (
    <div className="relative shrink-0" data-testid="file-tree-flyout">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        onMouseEnter={openPanel}
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-aop-charcoal bg-aop-dark p-1 text-aop-slate-dark transition-colors hover:border-aop-slate-dark hover:bg-aop-charcoal hover:text-aop-slate-light"
        data-testid="flyout-pill"
        aria-label="Toggle file tree"
      >
        <FolderIcon />
      </button>

      {open && (
        <div
          className="fixed z-50 min-w-[200px] rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-2 shadow-lg"
          style={{ top: panelPos.top, left: panelPos.left }}
          onMouseLeave={() => setOpen(false)}
          data-testid="flyout-panel"
          role="menu"
        >
          <div className="mb-1 px-2 font-mono text-[9px] text-aop-slate-dark">TASK FILES</div>
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              activeFile={activeFile}
              onSelect={handleSelect}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  );
};
