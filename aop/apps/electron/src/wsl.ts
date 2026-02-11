/* biome-ignore-all lint/suspicious/noConsole: WSL setup logging */
import { type ChildProcess, spawn } from "node:child_process";
import { dialog } from "electron";
import { buildWslCommand } from "./wsl-command";

export interface WslPaths {
  serverBinary: string;
  dashboardStatic: string;
  dbPath: string;
}

export const isWslAvailable = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    const proc = spawn("wsl.exe", ["--status"], { windowsHide: true });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
};

export const getDefaultDistro = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    const proc = spawn("wsl.exe", ["-l", "-q"], { windowsHide: true });
    let output = "";

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString("utf16le").replace(/\0/g, "").trim();
      output += text;
    });

    proc.on("error", () => resolve(null));
    proc.on("exit", (code) => {
      if (code !== 0 || !output) {
        resolve(null);
        return;
      }

      const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      resolve(lines[0] || null);
    });
  });
};

const getWslHomeDir = async (distro: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("wsl.exe", ["-d", distro, "-e", "sh", "-c", "echo $HOME"], {
      windowsHide: true,
    });

    let output = "";

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error("Failed to get WSL home directory"));
      } else {
        resolve(output.trim());
      }
    });
  });
};

export const wslPathFromWindows = async (distro: string, windowsPath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn("wsl.exe", ["-d", distro, "wslpath", windowsPath], {
      windowsHide: true,
    });

    let output = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[WSL] wslpath failed: ${stderr}`);
        // Fallback to manual conversion
        let path = windowsPath.replace(/\\/g, "/");
        if (path.match(/^[A-Za-z]:/)) {
          const driveLetter = path.charAt(0).toLowerCase();
          path = `/mnt/${driveLetter}${path.slice(2)}`;
        }
        resolve(path);
      } else {
        resolve(output.trim());
      }
    });
  });
};

export interface SyncResourcesOptions {
  skillsPath?: string;
  codexPath?: string;
}

export const syncResourcesToWsl = async (
  distro: string,
  serverBinaryPath: string,
  dashboardPath: string,
  options?: SyncResourcesOptions,
): Promise<WslPaths> => {
  const { skillsPath, codexPath } = options ?? {};

  const homeDir = await getWslHomeDir(distro);
  const wslTargetDir = `${homeDir}/.aop`;
  const wslServerPath = `${wslTargetDir}/aop-server`;
  const wslDashboardPath = `${wslTargetDir}/dashboard`;
  const wslDbPath = `${wslTargetDir}/aop.db`;

  // Convert Windows paths to WSL paths using wslpath command
  const wslSourceServer = await wslPathFromWindows(distro, serverBinaryPath);
  const wslSourceDashboard = await wslPathFromWindows(distro, dashboardPath);

  await runWslCommand(distro, `mkdir -p ${wslTargetDir}`);

  await runWslCommand(
    distro,
    `test -f "${wslSourceServer}" || (echo "File not found: ${wslSourceServer}" && exit 1)`,
  );

  await runWslCommand(distro, `rm -f ${wslServerPath}`); // avoids "Text file busy" if prior instance running
  await runWslCommand(distro, `cp "${wslSourceServer}" ${wslServerPath}`);
  await runWslCommand(distro, `chmod +x ${wslServerPath}`);

  await runWslCommand(
    distro,
    `test -x ${wslServerPath} || (echo "Binary is not executable: ${wslServerPath}" && exit 1)`,
  );

  try {
    await runWslCommand(
      distro,
      `test -f /lib64/ld-linux-x86-64.so.2 && echo "Dynamic linker: OK" || echo "Dynamic linker: MISSING"`,
    );
  } catch (_err) {
    console.error(`[WSL] Dynamic linker check failed - this may cause "not found" errors`);
  }

  await runWslCommand(
    distro,
    `test -d "${wslSourceDashboard}" || (echo "Directory not found: ${wslSourceDashboard}" && exit 1)`,
  );

  await runWslCommand(distro, `rm -rf ${wslDashboardPath}`);
  await runWslCommand(distro, `cp -r "${wslSourceDashboard}" ${wslDashboardPath}`);

  const mergeBundledIntoHome = async (
    sourcePath: string,
    targetDir: string,
    parentDir?: string,
  ) => {
    const wslSource = await wslPathFromWindows(distro, sourcePath);
    if (parentDir) await runWslCommand(distro, `mkdir -p ${parentDir}`);
    await runWslCommand(
      distro,
      `test -d "${wslSource}" || (echo "Dir not found: ${wslSource}" && exit 1)`,
    );
    const t = targetDir;
    const s = wslSource;
    const mergeScript = `
      if [ -d "${t}" ]; then
        chmod -R u+w "${t}" 2>/dev/null || true
        bk="${t}.backup.$(date +%Y%m%d%H%M%S)"
        cp -r "${t}" "$bk" 2>/dev/null || true
      fi
      mkdir -p "${t}"
      for item in "${s}"/*; do
        [ -e "$item" ] || continue
        cp -rf "$item" "${t}/"
      done
    `;
    await runWslCommand(distro, mergeScript);
  };

  if (skillsPath)
    await mergeBundledIntoHome(skillsPath, `${homeDir}/.claude/skills`, `${homeDir}/.claude`);
  if (codexPath) await mergeBundledIntoHome(codexPath, `${homeDir}/.codex`);

  return {
    serverBinary: wslServerPath,
    dashboardStatic: wslDashboardPath,
    dbPath: wslDbPath,
  };
};

const runWslCommand = (distro: string, command: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Use sh instead of bash (more universally available)
    const proc = spawn("wsl.exe", ["-d", distro, "-e", "sh", "-c", command], {
      windowsHide: true,
    });

    let stderr = "";

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`WSL command failed: ${command}\n${stderr}`));
      } else {
        resolve();
      }
    });
  });
};

export const spawnInWsl = (
  distro: string,
  command: string,
  env: Record<string, string>,
): ChildProcess => {
  const fullCommand = buildWslCommand(command, env);
  return spawn("wsl.exe", ["-d", distro, "-e", "sh", "-c", fullCommand], {
    windowsHide: true,
    detached: false,
  });
};

export const showWslNotInstalledDialog = (): void => {
  dialog.showErrorBox(
    "WSL Not Installed",
    "Windows Subsystem for Linux (WSL) is required to run AOP Desktop on Windows.\n\n" +
      "Please install WSL by running this command in PowerShell as Administrator:\n\n" +
      "    wsl --install\n\n" +
      "Then restart your computer and try again.\n\n" +
      "For more information, visit:\n" +
      "https://docs.microsoft.com/en-us/windows/wsl/install",
  );
};

export const showNoDistroDialog = (): void => {
  dialog.showErrorBox(
    "No WSL Distribution",
    "No Linux distribution is installed in WSL.\n\n" +
      "Please install a distribution by running this command in PowerShell:\n\n" +
      "    wsl --install Ubuntu\n\n" +
      "Then try again.\n\n" +
      "For more information, visit:\n" +
      "https://docs.microsoft.com/en-us/windows/wsl/install",
  );
};

export const showWslMissingPackagesDialog = (distro: string): void => {
  // Docker Desktop uses Alpine Linux (apk), most others use Ubuntu/Debian (apt)
  const isDockerDesktop = distro.toLowerCase().includes("docker");

  let instructions = "";

  if (isDockerDesktop) {
    // Alpine Linux (Docker Desktop)
    instructions =
      `Your WSL distribution (${distro}) uses Alpine Linux and is missing required system libraries.\n\n` +
      "To fix this, open PowerShell and run:\n\n" +
      `    wsl -d ${distro} -e sh -c "apk add --no-cache gcompat"\n\n` +
      "Or manually:\n" +
      `    wsl -d ${distro}\n` +
      "    apk add --no-cache gcompat\n\n" +
      "NOTE: Docker Desktop WSL is minimal and not recommended for development.\n" +
      "Consider installing Ubuntu WSL instead:\n" +
      "    wsl --install Ubuntu\n\n" +
      "Then restart AOP Desktop with Ubuntu as default.";
  } else {
    // Debian/Ubuntu (apt-get)
    instructions =
      `Your WSL distribution (${distro}) is missing required system libraries.\n\n` +
      "This commonly happens with minimal WSL installations.\n\n" +
      "To fix this, open PowerShell and run:\n\n" +
      `    wsl -d ${distro} -e sh -c "apt-get update && apt-get install -y libc6"\n\n` +
      "Or manually:\n" +
      `    wsl -d ${distro}\n` +
      "    sudo apt-get update\n" +
      "    sudo apt-get install -y libc6\n\n" +
      "Then restart AOP Desktop.";
  }

  dialog.showErrorBox("WSL Missing Base Packages", instructions);
};
