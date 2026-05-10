import { spawn } from "node:child_process";
import path from "node:path";
import type { ExecuteResult, BashToolParams } from "./types.js";
import { collectStream, truncateOutput, stripAnsi, normalizeNewlines } from "./output.js";
import { processRegistry } from "./process-registry.js";

// --- Security: command blacklist ---

const BLACKLIST_PATTERNS: RegExp[] = [
  /^rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(\s|$)/, // rm -rf /
  /:\(\)\{.*\|.*\&.*\}/, // fork bomb
  /mkfs\./, // format disk
  /dd\s+.*of=\/dev\//, // dd to device
  />\s*\/dev\/sd/, // write to disk device
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

function resolveShell(): { cmd: string; arg: string } {
  if (process.platform === "win32") {
    const pwsh = process.env.POWERSHELL_PATH ?? "pwsh.exe";
    return { cmd: pwsh, arg: "-Command" };
  }
  const shell = process.env.SHELL ?? "/bin/bash";
  return { cmd: shell, arg: "-c" };
}

// --- Working directory management ---

const projectRoot = path.resolve(process.cwd());
let currentDir = projectRoot;

function resolveCwd(cwd?: string): string {
  if (!cwd) return currentDir;
  const resolved = path.resolve(currentDir, cwd);
  if (!resolved.startsWith(projectRoot)) {
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
    if (!resolved.startsWith(projectRoot)) {
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
  const { cmd: shell, arg: shellArg } = resolveShell();
  const env = sanitizeEnv();

  const start = Date.now();

  // Background mode
  if (params.background) {
    const proc = spawn(shell, [shellArg, command], {
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
    const proc = spawn(shell, [shellArg, command], {
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
