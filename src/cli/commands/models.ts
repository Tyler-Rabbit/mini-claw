import { Command } from "commander";
import { intro, outro, spinner, isCancel, cancel } from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { discoverProviders } from "../../plugins/discover-providers.js";
import { configureProvider } from "./provider-config.js";
import { getConfigFilePath, getConfigDir, ensureConfigDir } from "../../config/paths.js";

async function loadConfig(): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(getConfigFilePath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveConfig(config: Record<string, unknown>): Promise<void> {
  await ensureConfigDir();
  await writeFile(getConfigFilePath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function addModelsCommand(program: Command): void {
  const models = program
    .command("models")
    .description("Manage AI models and provider auth");

  // --- models list ---
  models
    .command("list")
    .description("List configured providers and their models")
    .action(async () => {
      const config = await loadConfig();
      const agent = (config.agent as Record<string, unknown>) ?? {};
      const providers = (agent.providers as Record<string, Record<string, unknown>>) ?? {};
      const defaultProvider = agent.defaultProvider ?? "claude";
      const defaultModel = agent.defaultModel ?? "";

      console.log(`Default provider: ${defaultProvider}`);
      if (defaultModel) console.log(`Default model: ${defaultModel}`);
      console.log();

      const entries = Object.entries(providers);
      if (entries.length === 0) {
        console.log("No providers configured. Run 'mini-claw models auth add' to add one.");
        return;
      }

      for (const [id, prov] of entries) {
        const marker = id === defaultProvider ? " (default)" : "";
        console.log(`  ${id}${marker}`);
        if (prov.model) console.log(`    model: ${prov.model}`);
        if (prov.protocol) console.log(`    protocol: ${prov.protocol}`);
        if (prov.baseUrl) console.log(`    base URL: ${prov.baseUrl}`);
        console.log(`    API key: ${prov.apiKey ? "****" + String(prov.apiKey).slice(-4) : "not set"}`);
      }
    });

  // --- models set ---
  models
    .command("set <model>")
    .description("Set the default model")
    .action(async (model: string) => {
      const config = await loadConfig();
      const agent = (config.agent as Record<string, unknown>) ?? {};
      agent.defaultModel = model;
      config.agent = agent;
      await saveConfig(config);
      console.log(`Default model set to: ${model}`);
    });

  // --- models auth ---
  const auth = models
    .command("auth")
    .description("Manage provider authentication");

  // --- models auth add ---
  auth
    .command("add")
    .description("Interactively add or update a provider")
    .action(async () => {
      intro("Add provider");

      const config = await loadConfig();
      const existingAgent = (config.agent as Record<string, unknown>) ?? {};
      const existingPlugins = (config.plugins as Record<string, unknown>) ?? {};
      const loadPaths = (existingPlugins.loadPaths as string[]) ?? ["./extensions"];
      const existingProviders = (existingAgent.providers as Record<string, Record<string, unknown>>) ?? {};

      // Discover providers
      const discovered = await discoverProviders(loadPaths, getConfigDir());
      if (discovered.length === 0) {
        console.log("No providers found.");
        cancel("No providers available.");
        return;
      }

      const { select: selectPrompt } = await import("@clack/prompts");
      const providerChoice = await selectPrompt({
        message: "Select provider to configure:",
        options: discovered.map((p) => ({
          value: p.providerId,
          label: p.name,
          hint: p.builtin ? "built-in" : "plugin",
        })),
      });
      if (isCancel(providerChoice)) {
        cancel("Cancelled.");
        return;
      }

      const dp = discovered.find((p) => p.providerId === providerChoice)!;
      const provConfig = await configureProvider(dp, existingProviders[dp.providerId]);

      // Save
      const s = spinner();
      s.start("Saving");

      // Update agent.providers
      existingProviders[dp.providerId] = provConfig;
      existingAgent.providers = existingProviders;
      config.agent = existingAgent;

      // Update plugin entries for non-builtin
      if (!dp.builtin) {
        const entries = (existingPlugins.entries as Record<string, { enabled: boolean; config: Record<string, unknown> }>) ?? {};
        entries[dp.pluginId] = { enabled: true, config: provConfig };
        existingPlugins.entries = entries;
        config.plugins = existingPlugins;
      }

      // Update legacy fields for backward compat
      if (dp.providerId === "claude") {
        if (provConfig.apiKey) existingAgent.claudeApiKey = provConfig.apiKey;
        if (provConfig.model) existingAgent.claudeModel = provConfig.model;
      } else if (dp.providerId === "openai") {
        if (provConfig.apiKey) existingAgent.openaiApiKey = provConfig.apiKey;
        if (provConfig.model) existingAgent.openaiModel = provConfig.model;
      }

      await saveConfig(config);
      s.stop("Saved");

      outro(`Provider '${dp.name}' configured. Run 'mini-claw chat' to start.`);
    });
}
