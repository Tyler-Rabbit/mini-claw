import type { AgentTool, ModelProvider } from "../agent/types.js";
import type { ChannelPlugin } from "../channels/types.js";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  builtin?: boolean;
  type?: "provider" | "channel" | "tool";
  providerId?: string;
}

export interface PluginAPI {
  id: string;
  config: Record<string, unknown>;
  registerTool: (tool: AgentTool) => void;
  registerChannel: (channel: ChannelPlugin) => void;
  registerProvider: (provider: ModelProvider) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
}

export type PluginRegisterFn = (api: PluginAPI) => void;

export interface LoadedPlugin {
  manifest: PluginManifest;
  register: PluginRegisterFn;
  config: Record<string, unknown>;
}
