import { readFile } from "node:fs/promises";
import type { CompactionConfig } from "../agent/types.js";
import { getConfigFilePath } from "./paths.js";

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  [key: string]: unknown;
}

export interface MiniClawConfig {
  gateway: {
    port: number;
    host: string;
  };
  agent: {
    defaultProvider: string;
    defaultModel: string;
    claudeApiKey?: string;
    openaiApiKey?: string;
    claudeModel?: string;
    openaiModel?: string;
    maxToolRounds: number;
    providers?: Record<string, ProviderConfig>;
    compaction?: Partial<CompactionConfig>;
  };
  plugins: {
    enabled: boolean;
    entries: Record<string, { enabled: boolean; config: Record<string, unknown> }>;
    loadPaths: string[];
  };
  channels: {
    telegram?: { token: string };
  };
}

const defaultConfig: MiniClawConfig = {
  gateway: {
    port: 18789,
    host: "127.0.0.1",
  },
  agent: {
    defaultProvider: "claude",
    defaultModel: "",
    maxToolRounds: 5,
  },
  plugins: {
    enabled: true,
    entries: {},
    loadPaths: ["./extensions"],
  },
  channels: {},
};

export async function loadConfig(configPath?: string): Promise<MiniClawConfig> {
  const path = configPath
    ? configPath
    : getConfigFilePath();

  try {
    const content = await readFile(path, "utf-8");
    const userConfig = JSON.parse(content);
    return deepMerge(defaultConfig as unknown as Record<string, unknown>, userConfig) as unknown as MiniClawConfig;
  } catch {
    // Config file doesn't exist or is invalid - use defaults
    return { ...defaultConfig } as MiniClawConfig;
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
