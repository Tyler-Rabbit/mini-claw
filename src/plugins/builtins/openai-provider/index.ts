import type { PluginAPI } from "../../types.js";
import { OpenAIProvider } from "./provider.js";

export default function register(api: PluginAPI): void {
  const apiKey = (api.config.apiKey as string) || process.env.OPENAI_API_KEY;
  const model = api.config.model as string | undefined;

  if (!apiKey) {
    api.logger.debug("OpenAI provider skipped (no API key)");
    return;
  }

  api.registerProvider(new OpenAIProvider(apiKey, model));
  api.logger.info("OpenAI provider registered");
}
