import type { AgentTool, ModelProvider } from "../agent/types.js";
import type { ChannelPlugin } from "../channels/types.js";
import type { SearchProvider } from "../agent/search-provider.js";
import type { Skill } from "../skills/types.js";
import type { LoadedPlugin, PluginAPI } from "./types.js";

export class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();
  private registeredTools: AgentTool[] = [];
  private registeredChannels: ChannelPlugin[] = [];
  private registeredProviders: ModelProvider[] = [];
  private registeredSearchProviders: SearchProvider[] = [];
  private registeredSkills: Skill[] = [];

  register(plugin: LoadedPlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
  }

  initAll(config: Record<string, Record<string, unknown>>): void {
    for (const [id, plugin] of this.plugins) {
      const pluginConfig = config[id] ?? {};

      const api: PluginAPI = {
        id,
        config: pluginConfig,
        registerTool: (tool) => {
          this.registeredTools.push(tool);
        },
        registerChannel: (channel) => {
          this.registeredChannels.push(channel);
        },
        registerProvider: (provider) => {
          this.registeredProviders.push(provider);
        },
        registerSearchProvider: (provider) => {
          this.registeredSearchProviders.push(provider);
        },
        registerSkill: (skill) => {
          this.registeredSkills.push(skill);
        },
        logger: {
          info: (...args) => console.log(`[plugin:${id}]`, ...args),
          warn: (...args) => console.warn(`[plugin:${id}]`, ...args),
          error: (...args) => console.error(`[plugin:${id}]`, ...args),
          debug: (...args) => console.debug(`[plugin:${id}]`, ...args),
        },
      };

      try {
        plugin.register(api);
        console.log(`[plugins] initialized: ${id}`);
      } catch (err) {
        console.error(`[plugins] failed to init ${id}:`, err);
      }
    }
  }

  getTools(): AgentTool[] {
    return this.registeredTools;
  }

  getChannels(): ChannelPlugin[] {
    return this.registeredChannels;
  }

  getProviders(): ModelProvider[] {
    return this.registeredProviders;
  }

  getSearchProviders(): SearchProvider[] {
    return this.registeredSearchProviders;
  }

  getSkills(): Skill[] {
    return this.registeredSkills;
  }

  list(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }
}
