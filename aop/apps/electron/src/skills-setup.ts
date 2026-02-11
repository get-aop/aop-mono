/** Merges bundled ~/.claude/skills and ~/.codex into user dir (backup, add/overwrite same names). */
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

const backupDir = (targetDir: string): void => {
  if (!fs.existsSync(targetDir)) return;
  try {
    const backupPath = `${targetDir}.backup.${Date.now()}`;
    copyDirRecursive(targetDir, backupPath);
  } catch {}
};

const mergeDir = (bundled: string, targetDir: string): void => {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
    const srcPath = path.join(bundled, entry.name);
    const destPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const setupDir = (bundled: string | null, targetDir: string): void => {
  if (!bundled) return;

  const targetParent = path.dirname(targetDir);

  try {
    if (!fs.existsSync(targetParent)) {
      fs.mkdirSync(targetParent, { recursive: true });
    }

    backupDir(targetDir);
    mergeDir(bundled, targetDir);
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
