import type { AccessTokenResponse, QQBotConfig, SendMessageBody } from "./types.js";

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const GATEWAY_URL = "https://api.sgroup.qq.com/gateway";

export class QQBotApiClient {
  private config: QQBotConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private baseUrl: string;

  constructor(config: QQBotConfig) {
    this.config = config;
    this.baseUrl = config.sandbox
      ? "https://sandbox.api.sgroup.qq.com"
      : "https://api.sgroup.qq.com";
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: this.config.appId,
        clientSecret: this.config.clientSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to get access token: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as AccessTokenResponse;
    this.accessToken = data.access_token;
    // Refresh 60 seconds before expiry
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  async getAuthHeader(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `QQBot ${token}` };
  }

  async getGatewayUrl(): Promise<string> {
    const headers = await this.getAuthHeader();
    const url = this.config.sandbox
      ? "https://sandbox.api.sgroup.qq.com/gateway"
      : GATEWAY_URL;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to get gateway URL: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { url: string };
    return data.url;
  }

  clearToken(): void {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async sendC2CMessage(openid: string, body: SendMessageBody): Promise<void> {
    const url = `${this.baseUrl}/v2/users/${openid}/messages`;
    await this.sendMessage(url, body);
  }

  async sendGroupMessage(groupOpenid: string, body: SendMessageBody): Promise<void> {
    const url = `${this.baseUrl}/v2/groups/${groupOpenid}/messages`;
    await this.sendMessage(url, body);
  }

  private async sendMessage(url: string, body: SendMessageBody): Promise<void> {
    try {
      const headers = await this.getAuthHeader();
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`QQ Bot API error ${res.status}: ${text}`);
      }
    } catch (err) {
      // Log but don't throw — avoid crashing the channel on transient failures
      console.error(`[qqbot] Failed to send message to ${url}:`, err);
    }
  }
}
