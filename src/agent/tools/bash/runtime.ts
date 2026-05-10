import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { ExecuteResult, BashToolParams } from "./types.js";
import { collectStream, truncateOutput, stripAnsi, normalizeNewlines } from "./output.js";
import { processRegistry } from "./process-registry.js";

// --- Security: command blacklist ---

const BLACKLIST_PATTERNS: RegExp[] = [
  // Unix
  /^rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(\s|$)/, // rm -rf /
  /:\(\)\{.*\|.*\&.*\}/, // fork bomb
  /mkfs\./, // format disk
  /dd\s+.*of=\/dev\//, // dd to device
  />\s*\/dev\/sd/, // write to disk device
  // Windows
  /rmdir\s+\/[sS]\s+\/[qQ]\s+[A-Za-z]:\\/, // rmdir /s /q C:\
  /Remove-Item\s+.*-Recurse\s+.*-Force\s+[A-Za-z]:\\/, // Remove-Item -Recurse -Force C:\
  /format\s+[A-Za-z]:/, // format C:
  /diskpart/i, // diskpart
  /Remove-Item\s+.*-Recurse\s+.*\\$/, // Remove-Item -Recurse C:\
];

function checkBlacklist(command: string): string | null {
  for (const pattern of BLACKLIST_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by security policy: matches dangerous pattern`;
    }
  }
  return null;
}

// --- Environment sanitization ---

const BLOCKED_ENV_PREFIXES = ["LD_", "DYLD_"];

function sanitizeEnv(
  userEnv?: Record<string, string>,
): Record<string, string> {
  if (!userEnv) return { ...process.env } as Record<string, string>;

  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(userEnv)) {
    if (BLOCKED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue;
    }
    safe[key] = value;
  }
  return { ...process.env, ...safe } as Record<string, string>;
}

// --- Shell resolution ---

interface ShellInfo {
  cmd: string;
  arg: string;
  isPowerShell: boolean;
}

function resolveShell(): ShellInfo {
  if (process.platform === "win32") {
    const pwsh = process.env.POWERSHELL_PATH ?? "pwsh.exe";
    // Fall back to cmd.exe if PowerShell Core is not available
    const check = spawnSync(pwsh, ["-Version"], { stdio: "ignore", timeout: 3000 });
    if (check.error) {
      return { cmd: "cmd.exe", arg: "/c", isPowerShell: false };
    }
    return { cmd: pwsh, arg: "-Command", isPowerShell: true };
  }
  const shell = process.env.SHELL ?? "/bin/bash";
  return { cmd: shell, arg: "-c", isPowerShell: false };
}

/**
 * Wrap a command to normalize encoding on Windows.
 * PowerShell defaults to UTF-16LE in pipes — $OutputEncoding fixes most cmdlets.
 * cmd.exe uses OEM code page — TextDecoder in output.ts handles the decoding.
 */
function wrapWithEncoding(command: string, shell: ShellInfo): string {
  if (process.platform !== "win32") return command;
  if (shell.isPowerShell) {
    return `$OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
  }
  return command;
}

// --- Working directory management ---

const projectRoot = path.resolve(process.cwd());
let currentDir = projectRoot;

function isWithinProjectRoot(target: string): boolean {
  const rel = path.relative(projectRoot, target);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveCwd(cwd?: string): string {
  if (!cwd) return currentDir;
  const resolved = path.resolve(currentDir, cwd);
  if (!isWithinProjectRoot(resolved)) {
    throw new Error(
      `Working directory must be within the project root`,
    );
  }
  return resolved;
}

// --- Timeout constants ---

const DEFAULT_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 2_000;

// --- Core execution ---

export async function executeCommand(
  params: BashToolParams,
): Promise<ExecuteResult> {
  const command = params.command;
  if (!command) {
    throw new Error("command is required for action 'run'");
  }

  // Security check
  const blacklistHit = checkBlacklist(command);
  if (blacklistHit) {
    return {
      stdout: "",
      stderr: blacklistHit,
      exitCode: 1,
      truncated: false,
      duration: 0,
    };
  }

  // Handle cd specially — update tracked directory without spawning
  const cdMatch = command.match(/^\s*cd\s+(.+)\s*$/);
  if (cdMatch) {
    const target = cdMatch[1].replace(/^["']|["']$/g, "");
    const resolved = path.resolve(currentDir, target);
    if (!isWithinProjectRoot(resolved)) {
      return {
        stdout: "",
        stderr: "cd target must be within the project root",
        exitCode: 1,
        truncated: false,
        duration: 0,
      };
    }
    currentDir = resolved;
    return {
      stdout: `Changed directory to ${currentDir}`,
      stderr: "",
      exitCode: 0,
      truncated: false,
      duration: 0,
    };
  }

  const cwd = resolveCwd(params.cwd);
  const timeoutMs = params.timeout ?? DEFAULT_TIMEOUT_MS;
  const shell = resolveShell();
  const env = sanitizeEnv();
  const wrappedCommand = wrapWithEncoding(command, shell);

  const start = Date.now();

  // Background mode
  if (params.background) {
    const proc = spawn(shell.cmd, [shell.arg, wrappedCommand], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sessionId = processRegistry.register(proc);
    return {
      stdout: `Background process started. Session: ${sessionId}`,
      stderr: "",
      exitCode: null,
      truncated: false,
      duration: 0,
      sessionId,
    };
  }

  // Foreground mode
  return new Promise<ExecuteResult>((resolve) => {
    const proc = spawn(shell.cmd, [shell.arg, wrappedCommand], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let killed = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let killTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (killTimeoutHandle) clearTimeout(killTimeoutHandle);
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();
    };

    // Set up timeout
    timeoutHandle = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      killTimeoutHandle = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, KILL_GRACE_MS);
    }, timeoutMs);

    // Collect stdout and stderr concurrently
    const stdoutPromise = proc.stdout
      ? collectStream(proc.stdout)
      : Promise.resolve({ data: "", truncated: false });
    const stderrPromise = proc.stderr
      ? collectStream(proc.stderr)
      : Promise.resolve({ data: "", truncated: false });

    proc.on("close", async (code) => {
      cleanup();
      const [stdoutResult, stderrResult] = await Promise.all([
        stdoutPromise,
        stderrPromise,
      ]);
      const duration = Date.now() - start;
      const anyTruncated = stdoutResult.truncated || stderrResult.truncated;

      resolve({
        stdout: stdoutResult.data,
        stderr: stderrResult.data,
        exitCode: code,
        truncated: anyTruncated,
        duration,
      });
    });

    proc.on("error", (err) => {
      cleanup();
      resolve({
        stdout: "",
        stderr: `Process error: ${err.message}`,
        exitCode: 1,
        truncated: false,
        duration: Date.now() - start,
      });
    });
  });
}

/**
 * Reset working directory to project root (useful for tests).
 */
export function resetCwd(): void {
  currentDir = projectRoot;
}

/**
 * Get the current tracked working directory.
 */
export function getCurrentDir(): string {
  return currentDir;
}
