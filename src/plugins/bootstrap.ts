import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { MiniClawConfig } from "../config/config.js";
import type { ModelProvider, AgentTool } from "../agent/types.js";
import type { ChannelPlugin } from "../channels/types.js";
import type { SearchProvider } from "../agent/search-provider.js";
import type { Skill } from "../skills/types.js";
import { searchProviderRegistry } from "../agent/search-provider-registry.js";
import { getSkillSourceDirs } from "../config/paths.js";
import { PluginRegistry } from "./registry.js";
import { loadPluginsFromDir } from "./loader.js";
import { loadBuiltinPlugins } from "./builtins/index.js";
import { loadSkillsWithPriority } from "../skills/loader.js";

// Package root: dist/plugins/ -> dist/ -> root
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundledExtDir = join(packageRoot, "extensions");
const builtinSkillsDir = join(packageRoot, "skills");

export interface BootstrapResult {
  providers: ModelProvider[];
  tools: AgentTool[];
  channels: ChannelPlugin[];
  searchProviders: SearchProvider[];
  skills: Skill[];
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

  const searchProviders = registry.getSearchProviders();

  // Register search providers into the global singleton for tool access
  for (const sp of searchProviders) {
    searchProviderRegistry.register(sp);
  }

  // 5. Load skills from all sources with priority
  //
  // Priority (highest first):
  //   1. Workspace Skills     — <cwd>/skills
  //   2. Project Agent Skills — <cwd>/.agents/skills
  //   3. Personal Agent Skills — ~/.agents/skills
  //   4. Managed/Local Skills  — ~/.mini-claw/skills
  //   5. Built-in Skills       — <package>/skills
  //
  const skillDirs = getSkillSourceDirs(builtinSkillsDir);
  const fileSkills = await loadSkillsWithPriority(skillDirs);

  // Merge: file skills first (already deduplicated by priority),
  // then plugin-registered skills (only if not already present)
  const skillIds = new Set(fileSkills.map((s) => s.id));
  const pluginSkills = registry.getSkills().filter((s) => !skillIds.has(s.id));
  const allSkills: Skill[] = [...fileSkills, ...pluginSkills];

  return {
    providers: registry.getProviders(),
    tools: registry.getTools(),
    channels: registry.getChannels(),
    searchProviders,
    skills: allSkills,
    registry,
  };
}
