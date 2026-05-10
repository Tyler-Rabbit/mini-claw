import { join, resolve, dirname } from "node:path";
import type { MiniClawConfig } from "../config/config.js";
import type { ModelProvider, AgentTool } from "../agent/types.js";
import type { ChannelPlugin } from "../channels/types.js";
import { PluginRegistry } from "./registry.js";
import { loadPluginsFromDir } from "./loader.js";
import { loadBuiltinPlugins } from "./builtins/index.js";

// Package root: dist/plugins/ -> dist/ -> root
const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const bundledExtDir = join(packageRoot, "extensions");

export interface BootstrapResult {
  providers: ModelProvider[];
  tools: AgentTool[];
  channels: ChannelPlugin[];
  registry: PluginRegistry;
}

export async function bootstrapPlugins(config: MiniClawConfig): Promise<BootstrapResult> {
  const registry = new PluginRegistry();

  // 1. Register built-in plugins (Claude, OpenAI)
  loadBuiltinPlugins(registry);

  // 2. Register external plugins from loadPaths
  if (config.plugins.enabled) {
    // Deduplicate: collect all dirs, bundled first
    const dirs = new Set<string>();
    dirs.add(bundledExtDir);
    for (const loadPath of config.plugins.loadPaths) {
      const absPath = resolve(loadPath);
      dirs.add(absPath);
    }

    for (const dir of dirs) {
      const plugins = await loadPluginsFromDir(dir);
      for (const plugin of plugins) {
        const entry = config.plugins.entries[plugin.manifest.id];
        if (entry && entry.enabled === false) continue;
        registry.register(plugin);
      }
    }
  }

  // 3. Build plugin configs
  const pluginConfigs: Record<string, Record<string, unknown>> = {};

  // Built-in provider configs (new providers map takes precedence over legacy fields)
  pluginConfigs["builtin:claude"] = {
    apiKey: config.agent.providers?.claude?.apiKey ?? config.agent.claudeApiKey,
    model: config.agent.providers?.claude?.model ?? config.agent.claudeModel,
  };
  pluginConfigs["builtin:openai"] = {
    apiKey: config.agent.providers?.openai?.apiKey ?? config.agent.openaiApiKey,
    model: config.agent.providers?.openai?.model ?? config.agent.openaiModel,
  };

  // External plugin configs
  for (const [id, entry] of Object.entries(config.plugins.entries)) {
    pluginConfigs[id] = entry.config ?? {};
  }

  // 4. Initialize all plugins
  registry.initAll(pluginConfigs);

  return {
    providers: registry.getProviders(),
    tools: registry.getTools(),
    channels: registry.getChannels(),
    registry,
  };
}
