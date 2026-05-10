import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

const CONFIG_DIR_NAME = process.env.MINI_CLAW_ENV === "dev" ? ".mini-claw-dev" : ".mini-claw";

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), "mini-claw.json");
}

export async function ensureConfigDir(): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
}
