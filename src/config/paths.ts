import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

const CONFIG_DIR_NAME = process.env.MINI_CLAW_ENV === "dev" ? ".mini-claw-dev" : ".mini-claw";
const AGENTS_DIR_NAME = ".agents";

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), "mini-claw.json");
}

export function getSessionsDir(): string {
  return join(getConfigDir(), "sessions");
}

export function getWorkspaceDir(): string {
  return join(getConfigDir(), "workspace");
}

export function getMemoryDir(): string {
  return join(getWorkspaceDir(), "memory");
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
}

/**
 * Get skill source directories in priority order (highest first).
 *
 * 1. Workspace Skills    — <cwd>/skills
 * 2. Project Agent Skills — <cwd>/.agents/skills
 * 3. Personal Agent Skills — ~/.agents/skills
 * 4. Managed/Local Skills  — ~/.mini-claw/skills
 * 5. Built-in Skills       — <package>/skills
 */
export function getSkillSourceDirs(builtinDir: string): string[] {
  const cwd = process.cwd();
  const home = homedir();

  return [
    join(cwd, "skills"),                          // 1. workspace
    join(cwd, AGENTS_DIR_NAME, "skills"),          // 2. project agents
    join(home, AGENTS_DIR_NAME, "skills"),         // 3. personal agents
    join(getConfigDir(), "skills"),                // 4. managed/local
    resolve(builtinDir),                           // 5. built-in
  ];
}
