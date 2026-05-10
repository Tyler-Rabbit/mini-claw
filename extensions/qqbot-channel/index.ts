import type { PluginAPI } from "../../src/plugins/types.js";
import { QQBotChannel } from "./src/channel.js";

export default function register(api: PluginAPI): void {
  const appId = api.config.appId as string;
  const clientSecret = api.config.clientSecret as string;
  const sandbox = (api.config.sandbox as boolean) ?? false;

  if (!appId || !clientSecret) {
    api.logger.warn(
      "QQ Bot channel: appId and clientSecret are required in plugin config, skipping",
    );
    return;
  }

  const channel = new QQBotChannel({
    config: { appId, clientSecret, sandbox },
    logger: api.logger,
  });

  api.registerChannel(channel);
  api.logger.info("QQ Bot channel registered");
}
