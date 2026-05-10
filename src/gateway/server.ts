import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { Router } from "./router.js";
import { Broadcaster } from "./broadcast.js";
import { GatewayClient } from "./client.js";

export interface GatewayServerOptions {
  port?: number;
  host?: string;
}

export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private router: Router;
  private broadcaster: Broadcaster;
  private clients = new Map<string, GatewayClient>();

  constructor() {
    this.router = new Router();
    this.broadcaster = new Broadcaster();
  }

  getRouter(): Router {
    return this.router;
  }

  getBroadcaster(): Broadcaster {
    return this.broadcaster;
  }

  async start(options: GatewayServerOptions = {}): Promise<void> {
    const port = options.port ?? 18789;
    const host = options.host ?? "127.0.0.1";

    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port, host }, () => {
        console.log(`[gateway] WebSocket server listening on ws://${host}:${port}`);
        resolve();
      });

      this.wss.on("connection", (ws: WebSocket) => {
        const clientId = randomUUID().slice(0, 8);
        const client = new GatewayClient(clientId, ws, this.router, this.broadcaster);
        this.clients.set(clientId, client);
        this.broadcaster.add(clientId, ws);
        console.log(`[gateway] client connected: ${clientId}`);
      });

      this.wss.on("error", (err) => {
        console.error("[gateway] server error:", err.message);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.wss) return;
    return new Promise((resolve) => {
      this.wss!.close(() => {
        console.log("[gateway] server stopped");
        resolve();
      });
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
