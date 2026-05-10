import type { PluginRegistry } from "../registry.js";
import type { LoadedPlugin } from "../types.js";
import claudeRegister from "./claude-provider/index.js";
import openaiRegister from "./openai-provider/index.js";

// Import manifests as static JSON
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const claudeManifest = require("./claude-provider/mini-claw.plugin.json");
const openaiManifest = require("./openai-provider/mini-claw.plugin.json");

export function loadBuiltinPlugins(registry: PluginRegistry): void {
  const builtins: LoadedPlugin[] = [
    { manifest: claudeManifest, register: claudeRegister, config: {} },
    { manifest: openaiManifest, register: openaiRegister, config: {} },
  ];

  for (const plugin of builtins) {
    registry.register(plugin);
  }
}
