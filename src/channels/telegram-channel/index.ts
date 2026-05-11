import type { ChannelPlugin, ChannelDeps, ChannelMeta } from "../types.js";

/**
 * Telegram Channel - simplified example.
 * In production, you'd use grammY or the Telegram Bot API.
 * This shows the interface pattern without requiring a real Telegram token.
 */
export class TelegramChannel implements ChannelPlugin {
  id = "telegram";
  meta: ChannelMeta = {
    id: "telegram",
    label: "Telegram",
    description: "Telegram Bot channel (requires TELEGRAM_BOT_TOKEN env var)",
  };

  private token: string;
  private deps: ChannelDeps | null = null;
  private polling = false;

  constructor(token: string) {
    this.token = token;
  }

  async start(deps: ChannelDeps): Promise<void> {
    this.deps = deps;
    console.log("[telegram] Telegram channel started (stub)");
    console.log("[telegram] In production, this would poll the Telegram Bot API");
    // In production: start long-polling or webhook server
    // this.startPolling();
  }

  async stop(): Promise<void> {
    this.polling = false;
    console.log("[telegram] Telegram channel stopped");
  }

  // Simulated message handling for demonstration
  async handleTelegramMessage(
    chatId: string,
    text: string,
    userId: string,
    userName: string
  ): Promise<void> {
    if (!this.deps) return;

    const response = await this.deps.onMessage({
      text,
      senderId: userId,
      senderName: userName,
      channel: "telegram",
      sessionKey: `agent:main:telegram:${chatId}`,
      timestamp: new Date(),
    });

    // In production: send response back via Telegram API
    console.log(`[telegram] Would reply to ${chatId}: ${response}`);
  }
}
