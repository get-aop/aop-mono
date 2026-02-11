/** Symlinks bundled ~/.claude/skills and ~/.codex on first run (copy on Windows). */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const getHomeDir = (): string => process.env.HOME || process.env.USERPROFILE || "";

const getBundledPath = (devRelPath: string[], packagedDir: string): string | null => {
  if (!app.isPackaged) {
    const devPath = path.join(__dirname, "..", "..", "..", ...devRelPath);
    return fs.existsSync(devPath) ? devPath : null;
  }
  const resourcesPath = path.join(process.resourcesPath, packagedDir);
  return fs.existsSync(resourcesPath) ? resourcesPath : null;
};

const copyDirRecursive = (src: string, dest: string): void => {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const isAlreadyCorrectSymlink = (targetDir: string, bundled: string): boolean => {
  const stat = fs.lstatSync(targetDir);
  if (!stat.isSymbolicLink()) return false;
  const currentTarget = fs.readlinkSync(targetDir);
  return path.resolve(currentTarget) === path.resolve(bundled);
};

const hasExistingContent = (targetDir: string): boolean => {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  return entries.length > 0;
};

const clearTargetIfNeeded = (targetDir: string, bundled: string): boolean => {
  if (!fs.existsSync(targetDir)) return true;
  if (isAlreadyCorrectSymlink(targetDir, bundled)) return false;
  if (hasExistingContent(targetDir)) return false;
  fs.rmSync(targetDir, { recursive: true, force: true });
  return true;
};

const setupDir = (bundled: string | null, targetDir: string): void => {
  if (!bundled) return;

  const targetParent = path.dirname(targetDir);

  try {
    if (!fs.existsSync(targetParent)) {
      fs.mkdirSync(targetParent, { recursive: true });
    }

    if (!clearTargetIfNeeded(targetDir, bundled)) return;

    if (process.platform === "win32") {
      copyDirRecursive(bundled, targetDir);
    } else {
      fs.symlinkSync(bundled, targetDir, "dir");
    }
  } catch {}
};

export const setupSkillsOnFirstRun = (): void => {
  const home = getHomeDir();
  if (!home) return;

  const claudeBundled = getBundledPath([".claude", "skills"], "claude-skills");
  setupDir(claudeBundled, path.join(home, ".claude", "skills"));

  const codexBundled = getBundledPath([".codex"], "codex");
  setupDir(codexBundled, path.join(home, ".codex"));
};
