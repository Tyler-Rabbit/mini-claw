import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { discoverProviders } from "../../plugins/discover-providers.js";
import { getConfigFilePath, getConfigDir } from "../../config/paths.js";

async function loadConfig(): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(getConfigFilePath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function addProvidersCommand(program: Command): void {
  const providers = program
    .command("providers")
    .description("Manage AI model providers");

  providers
    .command("list")
    .description("List discovered provider plugins")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig();
      const loadPaths = ((config.plugins as Record<string, unknown>)?.loadPaths as string[]) ?? ["./extensions"];
      const discovered = await discoverProviders(loadPaths, getConfigDir());

      if (options.json) {
        console.log(JSON.stringify(discovered, null, 2));
        return;
      }

      if (discovered.length === 0) {
        console.log("No providers found. Add plugins to ./extensions/");
        return;
      }

      // Table output
      const cols = {
        id: Math.max(4, ...discovered.map((p) => p.providerId.length)),
        name: Math.max(4, ...discovered.map((p) => p.name.length)),
        source: Math.max(6, ...discovered.map((p) => (p.builtin ? "built-in" : "plugin").length)),
      };

      const header = [
        "ID".padEnd(cols.id),
        "Name".padEnd(cols.name),
        "Source".padEnd(cols.source),
      ].join("  ");

      const sep = [
        "-".repeat(cols.id),
        "-".repeat(cols.name),
        "-".repeat(cols.source),
      ].join("  ");

      console.log(header);
      console.log(sep);

      for (const p of discovered) {
        console.log([
          p.providerId.padEnd(cols.id),
          p.name.padEnd(cols.name),
          (p.builtin ? "built-in" : "plugin").padEnd(cols.source),
        ].join("  "));
      }
    });
}
