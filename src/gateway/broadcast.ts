import type { WebSocket } from "ws";
import type { EventFrame } from "./protocol/types.js";

export class Broadcaster {
  private clients = new Map<string, WebSocket>();

  add(id: string, ws: WebSocket): void {
    this.clients.set(id, ws);
  }

  remove(id: string): void {
    this.clients.delete(id);
  }

  broadcast(frame: EventFrame): void {
    const data = JSON.stringify(frame);
    for (const [id, ws] of this.clients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      } else {
        this.clients.delete(id);
      }
    }
  }

  send(clientId: string, frame: EventFrame | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: { message: string; code?: string } }): boolean {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }

  get size(): number {
    return this.clients.size;
  }
}
