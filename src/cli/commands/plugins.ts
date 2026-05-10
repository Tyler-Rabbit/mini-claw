import { Command } from "commander";
import { loadConfig } from "../../config/config.js";
import { loadPluginsFromDir } from "../../plugins/loader.js";
import { PluginRegistry } from "../../plugins/registry.js";

export function addPluginsCommand(program: Command): void {
  const plugins = program
    .command("plugins")
    .description("Manage plugins");

  plugins
    .command("list")
    .description("List available and loaded plugins")
    .option("-c, --config <path>", "Config file path")
    .action(async (options) => {
      const config = await loadConfig(options.config);
      const registry = new PluginRegistry();

      for (const loadPath of config.plugins.loadPaths) {
        const plugins = await loadPluginsFromDir(loadPath);
        for (const plugin of plugins) {
          registry.register(plugin);
        }
      }

      const loaded = registry.list();

      if (loaded.length === 0) {
        console.log("No plugins found.");
        console.log(`\nSearched in: ${config.plugins.loadPaths.join(", ")}`);
        return;
      }

      console.log("\nLoaded Plugins:");
      console.log("─".repeat(50));
      for (const plugin of loaded) {
        const m = plugin.manifest;
        console.log(`  ${m.name} (${m.id}) v${m.version}`);
        if (m.description) {
          console.log(`    ${m.description}`);
        }
      }
      console.log("─".repeat(50));
      console.log(`Total: ${loaded.length} plugin(s)`);
    });
}
