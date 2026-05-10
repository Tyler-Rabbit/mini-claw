import WebSocket from "ws";
import { QQBotApiClient } from "./api.js";
import type {
  GatewayHello,
  GatewayPayload,
  GatewayReady,
  QQBotC2CMessage,
  QQBotConfig,
  QQBotGroupMessage,
  QQBotEventHandler,
  ReadyHandler,
} from "./types.js";

// Intent bit for C2C + group events
const GROUP_AND_C2C_EVENT = 1 << 25;

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const MAX_RECONNECT_ATTEMPTS = 30;

export class QQBotGateway {
  private config: QQBotConfig;
  private logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; debug: (...a: unknown[]) => void };
  private onEvent: QQBotEventHandler;
  private onReady: ReadyHandler;

  private ws: WebSocket | null = null;
  private apiClient: QQBotApiClient | null = null;
  private sessionId: string | null = null;
  private lastSeq: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private gatewayUrl: string | null = null;
  private readyTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    config: QQBotConfig;
    logger: typeof QQBotGateway.prototype.logger;
    onEvent: QQBotEventHandler;
    onReady: ReadyHandler;
  }) {
    this.config = opts.config;
    this.logger = opts.logger;
    this.onEvent = opts.onEvent;
    this.onReady = opts.onReady;
  }

  async start(): Promise<void> {
    this.apiClient = new QQBotApiClient(this.config);
    this.gatewayUrl = await this.apiClient.getGatewayUrl();
    this.logger.info(`[qqbot] Gateway URL obtained: ${this.gatewayUrl}`);
    this.connect(this.gatewayUrl);
  }

  stop(): void {
    this.destroyed = true;
    this.clearHeartbeat();
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    this.logger.info("[qqbot] Gateway stopped");
  }

  private connect(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => this.onOpen());
    ws.on("message", (data: Buffer) => this.onMessage(data));
    ws.on("close", (code: number, reason: Buffer) => this.onClose(code, reason));
    ws.on("error", (err: Error) => this.onError(err));
  }

  private onOpen(): void {
    this.reconnectAttempts = 0;
    this.logger.info("[qqbot] WebSocket connected");
  }

  private onMessage(data: Buffer): void {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(data.toString()) as GatewayPayload;
    } catch {
      this.logger.error("[qqbot] Failed to parse gateway message");
      return;
    }

    switch (payload.op) {
      case 10: // Hello
        this.handleHello(payload.d as GatewayHello);
        break;

      case 0: // Dispatch
        this.handleDispatch(payload);
        break;

      case 1: // Heartbeat request from server
        this.sendHeartbeat();
        break;

      case 11: // Heartbeat ACK
        this.logger.debug("[qqbot] Heartbeat acknowledged");
        break;

      case 9: // Invalid Session
        this.logger.warn(`[qqbot] Invalid session (d=${JSON.stringify(payload.d)}), re-identifying...`);
        this.clearHeartbeat();
        this.sessionId = null;
        this.lastSeq = null;
        this.scheduleReconnect();
        break;

      case 7: // Reconnect
        this.logger.warn("[qqbot] Server requested reconnect");
        this.clearHeartbeat();
        this.sessionId = null;
        this.lastSeq = null;
        this.scheduleReconnect();
        break;

      default:
        this.logger.debug(`[qqbot] Unhandled op: ${payload.op}`);
    }
  }

  private handleHello(data: GatewayHello): void {
    const interval = data.heartbeat_interval;
    this.logger.info(`[qqbot] Hello received, heartbeat interval: ${interval}ms`);
    this.startHeartbeat(interval);

    if (this.sessionId) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }

    // If no READY event within 10 seconds, something is wrong
    this.readyTimeout = setTimeout(() => {
      if (!this.sessionId && !this.destroyed) {
        this.logger.error("[qqbot] No READY event received within 10s — bot may appear offline. Check appId/clientSecret and ensure intents are approved.");
      }
    }, 10_000);
  }

  private handleDispatch(payload: GatewayPayload): void {
    if (payload.s !== undefined) {
      this.lastSeq = payload.s;
    }

    const eventName = payload.t;

    if (eventName === "READY") {
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
      }
      const ready = payload.d as GatewayReady;
      this.sessionId = ready.session_id;
      this.logger.info(`[qqbot] READY — bot: ${ready.user.username} (${ready.user.id})`);
      this.onReady(ready);
      return;
    }

    if (eventName === "RESUMED") {
      this.logger.info("[qqbot] Session resumed");
      return;
    }

    if (eventName === "C2C_MESSAGE_CREATE") {
      this.onEvent({
        type: "C2C_MESSAGE_CREATE",
        data: payload.d as QQBotC2CMessage,
      });
      return;
    }

    if (eventName === "GROUP_AT_MESSAGE_CREATE") {
      this.onEvent({
        type: "GROUP_AT_MESSAGE_CREATE",
        data: payload.d as QQBotGroupMessage,
      });
      return;
    }

    this.logger.debug(`[qqbot] Unhandled dispatch event: ${eventName}`);
  }

  private async sendIdentify(): Promise<void> {
    if (!this.apiClient || !this.ws) return;

    try {
      const token = await this.apiClient.getAccessToken();
      const identify = {
        op: 2,
        d: {
          token: `QQBot ${token}`,
          intents: GROUP_AND_C2C_EVENT,
          shard: [0, 1],
          properties: {
            $os: process.platform,
            $browser: "mini-claw",
            $device: "mini-claw",
          },
        },
      };
      this.ws.send(JSON.stringify(identify));
      this.logger.info("[qqbot] Identify sent");
    } catch (err) {
      this.logger.error("[qqbot] Failed to send Identify:", err);
      this.scheduleReconnect();
    }
  }

  private async sendResume(): Promise<void> {
    if (!this.apiClient || !this.ws || !this.sessionId) return;

    try {
      const token = await this.apiClient.getAccessToken();
      const resume = {
        op: 6,
        d: {
          token: `QQBot ${token}`,
          session_id: this.sessionId,
          seq: this.lastSeq ?? 0,
        },
      };
      this.ws.send(JSON.stringify(resume));
      this.logger.info("[qqbot] Resume sent");
    } catch (err) {
      this.logger.error("[qqbot] Failed to send Resume:", err);
      // Fall back to Identify
      this.sessionId = null;
      this.sendIdentify();
    }
  }

  private startHeartbeat(interval: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ op: 1, d: this.lastSeq }));
    this.logger.debug("[qqbot] Heartbeat sent");
  }

  private onClose(code: number, reason: Buffer): void {
    const reasonStr = reason.toString() || "no reason";
    this.logger.warn(`[qqbot] WebSocket closed: code=${code} reason=${reasonStr}`);
    this.clearHeartbeat();
    this.ws = null;

    // Log specific close codes for debugging
    if (code === 4004) {
      this.logger.error("[qqbot] Authentication failed — check appId and clientSecret");
    } else if (code === 4014) {
      this.logger.error("[qqbot] Bot has been shut down or banned");
    } else if (code >= 4900 && code <= 4913) {
      // 4902 = "reset by resume" — session is invalid, must re-identify
      this.logger.warn("[qqbot] QQ gateway internal error, clearing session and will re-identify");
      this.sessionId = null;
      this.lastSeq = null;
    }

    if (!this.destroyed) {
      this.scheduleReconnect();
    }
  }

  private onError(err: Error): void {
    this.logger.error("[qqbot] WebSocket error:", err.message);
    // The 'close' event will follow and trigger reconnect
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    const delayIndex = Math.min(this.reconnectAttempts, RECONNECT_DELAYS.length - 1);
    const delay = RECONNECT_DELAYS[delayIndex];
    this.reconnectAttempts++;

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.logger.error("[qqbot] Max reconnect attempts reached, giving up");
      return;
    }

    this.logger.info(`[qqbot] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(async () => {
      if (this.destroyed) return;
      try {
        if (!this.apiClient) {
          this.apiClient = new QQBotApiClient(this.config);
        }
        // Force fresh token on reconnect
        this.apiClient.clearToken();
        this.gatewayUrl = await this.apiClient.getGatewayUrl();
        this.connect(this.gatewayUrl);
      } catch (err) {
        this.logger.error("[qqbot] Failed to reconnect:", err);
        this.scheduleReconnect();
      }
    }, delay);
  }
}
