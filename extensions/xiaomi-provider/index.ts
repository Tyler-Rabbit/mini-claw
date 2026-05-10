import type { PluginAPI } from "../../src/plugins/types.js";
import { XiaomiProvider, type XiaomiProtocol } from "./provider.js";

export default function register(api: PluginAPI): void {
  const apiKey = (api.config.apiKey as string) || process.env.XIAOMI_API_KEY;
  const model = api.config.model as string | undefined;
  const baseUrl = api.config.baseUrl as string | undefined;
  const protocol = (api.config.protocol as XiaomiProtocol) ?? "openai";

  if (!apiKey) {
    api.logger.warn("Xiaomi provider: no API key configured, skipping");
    return;
  }

  api.registerProvider(new XiaomiProvider({ apiKey, model, baseUrl, protocol }));
  api.logger.info(`Xiaomi provider registered (protocol: ${protocol})`);
}
