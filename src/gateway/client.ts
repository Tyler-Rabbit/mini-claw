import type { WebSocket, RawData } from "ws";
import type { RequestFrame, ResponseFrame, EventFrame } from "./protocol/types.js";
import type { Router } from "./router.js";
import type { Broadcaster } from "./broadcast.js";

export class GatewayClient {
  readonly id: string;
  private ws: WebSocket;
  private router: Router;
  private broadcaster: Broadcaster;
  private connected = false;

  constructor(
    id: string,
    ws: WebSocket,
    router: Router,
    broadcaster: Broadcaster
  ) {
    this.id = id;
    this.ws = ws;
    this.router = router;
    this.broadcaster = broadcaster;

    this.ws.on("message", (data) => this.handleMessage(data));
    this.ws.on("close", () => this.handleClose());
    this.ws.on("error", (err) => console.error(`[client:${id}] error:`, err.message));
  }

  private handleMessage(data: RawData): void {
    let frame: unknown;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      this.sendError("", "INVALID_JSON", "Failed to parse frame");
      return;
    }

    const f = frame as Record<string, unknown>;

    if (f.type !== "req") {
      this.sendError("", "INVALID_FRAME", "Expected type: req");
      return;
    }

    if (!this.connected && f.method !== "connect") {
      this.sendError(f.id as string, "NOT_CONNECTED", "First frame must be connect");
      return;
    }

    this.handleRequest(f as unknown as RequestFrame);
  }

  private async handleRequest(frame: RequestFrame): Promise<void> {
    if (frame.method === "connect") {
      this.connected = true;
      this.send({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { clientId: this.id, status: "connected" },
      });
      return;
    }

    await this.router.route(frame.method, {
      params: { ...((frame.params as Record<string, unknown>) ?? {}), id: frame.id },
      clientId: this.id,
      send: (f) => this.send(f),
    });
  }

  private handleClose(): void {
    this.connected = false;
    this.broadcaster.remove(this.id);
    console.log(`[client:${this.id}] disconnected`);
  }

  send(frame: ResponseFrame | EventFrame): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private sendError(id: string, code: string, message: string): void {
    this.send({
      type: "res",
      id,
      ok: false,
      error: { message, code },
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
