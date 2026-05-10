import { Command } from "commander";
import {
  intro,
  outro,
  select,
  multiselect,
  text,
  spinner,
  isCancel,
  cancel,
  note,
} from "@clack/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { discoverProviders } from "../../plugins/discover-providers.js";
import { discoverChannels } from "../../plugins/discover-channels.js";
import { configureProvider } from "./provider-config.js";
import { configureChannel } from "./channel-config.js";
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
      const existingGateway = (existing.gateway as Record<string, unknown>) ?? {};
      const existingEntries = (existingPlugins.entries as Record<string, { enabled: boolean; config: Record<string, unknown> }>) ?? {};

      // --- Ask what to configure ---
      const sections = await multiselect({
        message: "What do you want to configure?",
        options: [
          { value: "provider", label: "AI Provider" },
          { value: "channels", label: "Channels" },
          { value: "gateway", label: "Gateway port" },
        ],
        required: true,
      });
      handleCancel(sections);

      const selected = sections as string[];
      const wantProvider = selected.includes("provider");
      const wantChannels = selected.includes("channels");
      const wantGateway = selected.includes("gateway");

      // --- Discover available providers ---
      const discovered = await discoverProviders(loadPaths, getConfigDir());

      // --- Provider configuration ---
      let defaultProvider = existingAgent.defaultProvider as string ?? "claude";
      let providers: Record<string, Record<string, unknown>> = { ...existingProviders };

      if (wantProvider) {
        const providerOptions = discovered.map((p) => ({
          value: p.providerId,
          label: p.name,
          hint: p.builtin ? "built-in" : "plugin",
        }));

        if (providerOptions.length === 0) {
          providerOptions.push(
            { value: "claude", label: "Claude", hint: "built-in" },
            { value: "openai", label: "OpenAI", hint: "built-in" },
          );
        }

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
        defaultProvider = configureAll ? discovered[0]?.providerId ?? "claude" : selectedProvider;
        const providersToConfigure = configureAll
          ? discovered
          : discovered.filter((p) => p.providerId === selectedProvider);

        for (const dp of providersToConfigure) {
          providers[dp.providerId] = await configureProvider(dp, existingProviders[dp.providerId]);
        }
      }

      // --- Channel configuration ---
      let enabledChannels: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {};

      if (wantChannels) {
        const discoveredChannels = await discoverChannels(loadPaths, getConfigDir());

        if (discoveredChannels.length === 0) {
          note("No channel plugins found in extensions/", "Channels");
        } else {
          const channelOptions = discoveredChannels.map((ch) => ({
            value: ch.pluginId,
            label: ch.name,
            description: ch.description,
          }));

          const selectedChannels = await multiselect({
            message: "Which channels do you want to enable?",
            options: channelOptions,
            required: false,
          });
          handleCancel(selectedChannels);

          if (Array.isArray(selectedChannels)) {
            for (const ch of discoveredChannels) {
              if (selectedChannels.includes(ch.pluginId)) {
                const chConfig = await configureChannel(ch, existingEntries[ch.pluginId]?.config);
                enabledChannels[ch.pluginId] = { enabled: true, config: chConfig };
              }
            }
          }
        }
      }

      // --- Gateway port ---
      let port = existingGateway.port as number ?? 18789;

      if (wantGateway) {
        const portInput = await text({
          message: "Gateway WebSocket port:",
          defaultValue: String(port),
          placeholder: "18789",
          validate: (value) => {
            if (!value) return "Port is required";
            const n = parseInt(value);
            if (isNaN(n) || n < 1 || n > 65535) return "Must be a valid port number";
          },
        });
        handleCancel(portInput);
        port = parseInt(portInput as string) || 18789;
      }

      // --- Save ---
      const s = spinner();
      s.start("Saving configuration");

      const pluginEntries: Record<string, { enabled: boolean; config: Record<string, unknown> }> = {
        ...existingEntries,
      };
      // Merge provider plugin entries
      for (const dp of discovered) {
        if (!dp.builtin && providers[dp.providerId]) {
          pluginEntries[dp.pluginId] = {
            enabled: true,
            config: providers[dp.providerId] ?? {},
          };
        }
      }
      // Merge channel plugin entries
      for (const [chId, chEntry] of Object.entries(enabledChannels)) {
        pluginEntries[chId] = chEntry;
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
          port,
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

      const summaryLines = [];
      if (wantProvider) {
        summaryLines.push(`Default provider: ${defaultProvider}`);
        for (const [id, p] of Object.entries(providers)) {
          const parts = [`${id}: ${p.model || "default model"}`];
          if (p.protocol) parts.push(`  protocol: ${p.protocol}`);
          if (p.baseUrl) parts.push(`  base URL: ${p.baseUrl}`);
          summaryLines.push(parts.join("\n"));
        }
      }
      if (wantChannels) {
        const chIds = Object.keys(enabledChannels);
        if (chIds.length > 0) summaryLines.push(`Channels: ${chIds.join(", ")}`);
      }
      if (wantGateway) {
        summaryLines.push(`Gateway port: ${String(port)}`);
      }
      summaryLines.push(`Config file: ${getConfigFilePath()}`);

      note(summaryLines.join("\n"), "Setup complete");
      outro("You're all set! Run 'mini-claw chat' to start chatting.");
    });
}
