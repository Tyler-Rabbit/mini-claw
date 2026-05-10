import { text, password, confirm, isCancel, cancel } from "@clack/prompts";
import type { DiscoveredChannel } from "../../plugins/discover-channels.js";

function handleCancel(value: unknown): asserts value is NonNullable<typeof value> {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

/** Channel config schemas — keyed by pluginId */
const CHANNEL_SCHEMAS: Record<
  string,
  {
    label: string;
    fields: Array<{
      key: string;
      label: string;
      secret?: boolean;
      required?: boolean;
    }>;
    optionalFields?: Array<{
      key: string;
      label: string;
      defaultValue: string;
    }>;
  }
> = {
  "qqbot-channel": {
    label: "QQ Bot",
    fields: [
      { key: "appId", label: "App ID", required: true },
      { key: "clientSecret", label: "Client Secret", secret: true, required: true },
    ],
    optionalFields: [
      { key: "sandbox", label: "Use sandbox environment?", defaultValue: "false" },
    ],
  },
};

/**
 * Interactively configure a channel plugin.
 * Returns the channel config object.
 */
export async function configureChannel(
  channel: DiscoveredChannel,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = { ...(existing ?? {}) };
  const schema = CHANNEL_SCHEMAS[channel.pluginId];

  if (!schema) {
    // No known schema — just return existing config
    return config;
  }

  for (const field of schema.fields) {
    const hasValue = !!config[field.key];

    if (field.secret) {
      const value = await password({
        message: hasValue
          ? `${schema.label} ${field.label} (already set, press Enter to keep)`
          : `Enter ${schema.label} ${field.label}:`,
        validate: (v) => {
          if (field.required && !hasValue && !v) return `${field.label} is required`;
        },
      });
      handleCancel(value);
      if (value) config[field.key] = value;
    } else {
      const value = await text({
        message: `${schema.label} ${field.label}:`,
        defaultValue: String(config[field.key] ?? ""),
        validate: (v) => {
          if (field.required && !hasValue && !v) return `${field.label} is required`;
        },
      });
      handleCancel(value);
      if (value) config[field.key] = value;
    }
  }

  if (schema.optionalFields) {
    for (const field of schema.optionalFields) {
      const value = await confirm({
        message: `${schema.label}: ${field.label}`,
        initialValue: String(config[field.key] ?? field.defaultValue) === "true",
      });
      handleCancel(value);
      config[field.key] = value;
    }
  }

  return config;
}
