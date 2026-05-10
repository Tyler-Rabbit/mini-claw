import {
  select,
  text,
  password,
  isCancel,
  cancel,
} from "@clack/prompts";
import type { DiscoveredProvider } from "../../plugins/discover-providers.js";

const ENV_KEY_MAP: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
};

function handleCancel(value: unknown): asserts value is NonNullable<typeof value> {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

/**
 * Interactively configure a single provider.
 * Returns the provider config object (apiKey, model, protocol, baseUrl, etc.)
 */
export async function configureProvider(
  dp: DiscoveredProvider,
  existing?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const provConfig: Record<string, unknown> = { ...(existing ?? {}) };

  // --- Provider-specific options (e.g. Xiaomi protocol + baseUrl) ---
  if (dp.providerId === "xiaomi") {
    const protocol = await select({
      message: "API protocol:",
      options: [
        { value: "openai", label: "OpenAI compatible", hint: "/v1 endpoint" },
        { value: "anthropic", label: "Anthropic compatible", hint: "/anthropic endpoint" },
      ],
    });
    handleCancel(protocol);

    const defaultBase = protocol === "anthropic"
      ? "https://api.xiaomimimo.com/anthropic"
      : "https://api.xiaomimimo.com/v1";

    const baseUrl = await text({
      message: "Base URL:",
      defaultValue: String(provConfig.baseUrl ?? defaultBase),
      placeholder: defaultBase,
    });
    handleCancel(baseUrl);

    provConfig.protocol = protocol;
    provConfig.baseUrl = baseUrl || defaultBase;
  }

  // --- API Key ---
  const envKey = ENV_KEY_MAP[dp.providerId];
  const hasKey = !!(
    provConfig.apiKey || (envKey && process.env[envKey])
  );

  const apiKey = await password({
    message: hasKey
      ? `${dp.name} API key (already set, press Enter to keep)`
      : `Enter your ${dp.name} API key:`,
    validate: (value) => {
      if (!hasKey && !value) return `${dp.name} API key is required`;
    },
  });
  handleCancel(apiKey);
  if (apiKey) provConfig.apiKey = apiKey;

  // --- Model ---
  const model = await text({
    message: `${dp.name} model:`,
    defaultValue: String(provConfig.model ?? ""),
    placeholder: "use provider default",
  });
  handleCancel(model);
  if (model) provConfig.model = model;

  return provConfig;
}
