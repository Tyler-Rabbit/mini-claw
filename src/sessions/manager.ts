import type { ModelMessage } from "../agent/types.js";

export interface Session {
  key: string;
  channel: string;
  history: ModelMessage[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  getOrCreate(key: string, channel = "unknown"): Session {
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        key,
        channel,
        history: [],
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  has(key: string): boolean {
    return this.sessions.has(key);
  }

  delete(key: string): boolean {
    return this.sessions.delete(key);
  }

  clear(key: string): void {
    const session = this.sessions.get(key);
    if (session) {
      session.history = [];
      session.updatedAt = new Date();
    }
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }
}
