import { Command } from "commander";
import {
  intro,
  outro,
  select,
  text,
  spinner,
  isCancel,
  cancel,
  note,
} from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { discoverProviders } from "../../plugins/discover-providers.js";
import { configureProvider } from "./provider-config.js";
import { getConfigFilePath, getConfigDir, ensureConfigDir } from "../../config/paths.js";

function handleCancel(value: unknown): asserts value is NonNullable<typeof value> {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

async function loadExistingConfig(): Promise<Record<string, unknown>> {
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

export function addOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description("Interactive setup wizard to configure mini-claw")
    .action(async () => {
      intro("mini-claw setup");

      const existing = await loadExistingConfig();
      const existingAgent = (existing.agent as Record<string, unknown>) ?? {};
      const existingPlugins = (existing.plugins as Record<string, unknown>) ?? {};
      const loadPaths = (existingPlugins.loadPaths as string[]) ?? ["./extensions"];
      const existingProviders = (existingAgent.providers as Record<string, Record<string, unknown>>) ?? {};

      // --- Discover available providers ---
      const discovered = await discoverProviders(loadPaths, getConfigDir());
      const providerOptions = discovered.map((p) => ({
        value: p.providerId,
        label: p.name,
        hint: p.builtin ? "built-in" : "plugin",
      }));

      if (providerOptions.length > 2) {
        providerOptions.push({
          value: "all",
          label: "All providers",
          hint: "configure all discovered providers",
        });
      }

      const providerChoice = await select({
        message: "Which AI provider do you want to use?",
        options: providerOptions,
      });
      handleCancel(providerChoice);
      const selectedProvider = providerChoice as string;

      const configureAll = selectedProvider === "all";
      const defaultProvider = configureAll ? discovered[0]?.providerId ?? "claude" : selectedProvider;
      const providersToConfigure = configureAll
        ? discovered
        : discovered.filter((p) => p.providerId === selectedProvider);

      // --- Configure each provider ---
      const providers: Record<string, Record<string, unknown>> = {};
      for (const dp of providersToConfigure) {
        providers[dp.providerId] = await configureProvider(dp, existingProviders[dp.providerId]);
      }

      // --- Gateway port ---
      const existingGateway = (existing.gateway as Record<string, unknown>) ?? {};
      const port = await text({
        message: "Gateway WebSocket port:",
        defaultValue: String(existingGateway.port ?? 18789),
        placeholder: "18789",
        validate: (value) => {
          if (!value) return "Port is required";
          const n = parseInt(value);
          if (isNaN(n) || n < 1 || n > 65535) return "Must be a valid port number";
        },
      });
      handleCancel(port);

      // --- Save ---
      const s = spinner();
      s.start("Saving configuration");

      const pluginEntries: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {
        ...((existingPlugins.entries as Record<string, { enabled: boolean; config: Record<string, unknown> }>) ?? {}),
      };
      for (const dp of providersToConfigure) {
        if (!dp.builtin) {
          pluginEntries[dp.pluginId] = {
            enabled: true,
            config: providers[dp.providerId] ?? {},
          };
        }
      }

      const agentConfig: Record<string, unknown> = {
        defaultProvider,
        defaultModel: existingAgent.defaultModel ?? "",
        maxToolRounds: existingAgent.maxToolRounds ?? 5,
        providers,
        ...(providers.claude?.apiKey ? { claudeApiKey: providers.claude.apiKey } : {}),
        ...(providers.claude?.model ? { claudeModel: providers.claude.model } : {}),
        ...(providers.openai?.apiKey ? { openaiApiKey: providers.openai.apiKey } : {}),
        ...(providers.openai?.model ? { openaiModel: providers.openai.model } : {}),
      };

      const config: Record<string, unknown> = {
        ...existing,
        gateway: {
          ...(existingGateway ?? {}),
          port: parseInt(port as string) || 18789,
          host: existingGateway.host ?? "127.0.0.1",
        },
        agent: agentConfig,
        plugins: {
          enabled: true,
          entries: pluginEntries,
          loadPaths,
        },
      };

      await saveConfig(config);
      s.stop("Configuration saved");

      const summary = [
        `Default provider: ${defaultProvider}`,
        ...providersToConfigure.map((dp) => {
          const p = providers[dp.providerId] ?? {};
          const parts = [`${dp.name}: ${p.model || "default model"}`];
          if (p.protocol) parts.push(`  protocol: ${p.protocol}`);
          if (p.baseUrl) parts.push(`  base URL: ${p.baseUrl}`);
          return parts.join("\n");
        }),
        `Gateway port: ${String(port)}`,
        `Config file: ${getConfigFilePath()}`,
      ].join("\n");

      note(summary, "Setup complete");
      outro("You're all set! Run 'mini-claw chat' to start chatting.");
    });
}
