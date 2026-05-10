import type { PluginAPI } from "../../types.js";
import { ClaudeProvider } from "./provider.js";

export default function register(api: PluginAPI): void {
  const apiKey = (api.config.apiKey as string) || process.env.ANTHROPIC_API_KEY;
  const model = api.config.model as string | undefined;

  if (!apiKey) {
    api.logger.debug("Claude provider skipped (no API key)");
    return;
  }

  api.registerProvider(new ClaudeProvider(apiKey, model));
  api.logger.info("Claude provider registered");
}
