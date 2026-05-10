import type { ChannelPlugin, ChannelDeps, ChannelMeta, InboundMessage } from "../../../src/channels/types.js";
import { QQBotApiClient } from "./api.js";
import { QQBotGateway } from "./gateway.js";
import type {
  QQBotConfig,
  QQBotC2CMessage,
  QQBotGroupMessage,
  GatewayReady,
} from "./types.js";

export class QQBotChannel implements ChannelPlugin {
  readonly id = "qqbot";
  readonly meta: ChannelMeta = {
    id: "qqbot",
    label: "QQ Bot",
    description: "QQ Bot channel for C2C and group @mention messages",
  };

  private config: QQBotConfig;
  private logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; debug: (...a: unknown[]) => void };
  private gateway: QQBotGateway | null = null;
  private apiClient: QQBotApiClient | null = null;
  private deps: ChannelDeps | null = null;
  private botOpenid: string | null = null;

  constructor(opts: {
    config: QQBotConfig;
    logger: typeof QQBotChannel.prototype.logger;
  }) {
    this.config = opts.config;
    this.logger = opts.logger;
  }

  async start(deps: ChannelDeps): Promise<void> {
    this.deps = deps;
    this.apiClient = new QQBotApiClient(this.config);

    this.gateway = new QQBotGateway({
      config: this.config,
      logger: this.logger,
      onReady: (data: GatewayReady) => {
        this.botOpenid = data.user.id;
        this.logger.info(`[qqbot] Bot openid: ${this.botOpenid}`);
      },
      onEvent: (event) => {
        this.handleEvent(event.type, event.data).catch((err) => {
          this.logger.error("[qqbot] Error handling event:", err);
        });
      },
    });

    await this.gateway.start();
    this.logger.info("[qqbot] Channel started");
  }

  async stop(): Promise<void> {
    if (this.gateway) {
      this.gateway.stop();
      this.gateway = null;
    }
    this.apiClient = null;
    this.deps = null;
    this.botOpenid = null;
    this.logger.info("[qqbot] Channel stopped");
  }

  private async handleEvent(
    type: string,
    data: QQBotC2CMessage | QQBotGroupMessage,
  ): Promise<void> {
    if (!this.deps || !this.apiClient) return;

    if (type === "C2C_MESSAGE_CREATE") {
      const msg = data as QQBotC2CMessage;
      const inbound: InboundMessage = {
        text: msg.content,
        senderId: msg.author.id,
        senderName: msg.author.username,
        channel: this.id,
        sessionKey: `qqbot:c2c:${msg.author.id}`,
        timestamp: new Date(msg.timestamp),
      };

      this.logger.info(`[qqbot] C2C message from ${msg.author.username ?? msg.author.id}: ${msg.content}`);

      try {
        const response = await this.deps.onMessage(inbound);
        if (response) {
          await this.apiClient.sendC2CMessage(msg.author.id, {
            content: response,
            msg_type: 0,
            msg_id: msg.id,
          });
        }
      } catch (err) {
        this.logger.error("[qqbot] Error processing C2C message:", err);
      }
      return;
    }

    if (type === "GROUP_AT_MESSAGE_CREATE") {
      const msg = data as QQBotGroupMessage;
      // Strip all <@...> mention tokens from the content
      const cleanContent = msg.content.replace(/<@[^>]+>\s*/g, "").trim();

      if (!cleanContent) {
        this.logger.debug("[qqbot] Group message empty after stripping mentions, skipping");
        return;
      }

      const inbound: InboundMessage = {
        text: cleanContent,
        senderId: msg.author.member_openid,
        channel: this.id,
        sessionKey: `qqbot:group:${msg.group_openid}`,
        timestamp: new Date(msg.timestamp),
      };

      this.logger.info(`[qqbot] Group message from ${msg.author.member_openid} in ${msg.group_openid}: ${cleanContent}`);

      try {
        const response = await this.deps.onMessage(inbound);
        if (response) {
          await this.apiClient.sendGroupMessage(msg.group_openid, {
            content: response,
            msg_type: 0,
            msg_id: msg.id,
          });
        }
      } catch (err) {
        this.logger.error("[qqbot] Error processing group message:", err);
      }
      return;
    }
  }
}
