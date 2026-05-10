import { XiaomiProvider } from "./provider.js";
export default function register(api) {
    const apiKey = api.config.apiKey || process.env.XIAOMI_API_KEY;
    const model = api.config.model;
    const baseUrl = api.config.baseUrl;
    const protocol = api.config.protocol ?? "openai";
    if (!apiKey) {
        api.logger.warn("Xiaomi provider: no API key configured, skipping");
        return;
    }
    api.registerProvider(new XiaomiProvider({ apiKey, model, baseUrl, protocol }));
    api.logger.info(`Xiaomi provider registered (protocol: ${protocol})`);
}
