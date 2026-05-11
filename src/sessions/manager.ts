import type { ModelMessage } from "../agent/types.js";
import type { SessionStore } from "./store.js";

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
  private store?: SessionStore;

  constructor(store?: SessionStore) {
    this.store = store;
  }

  async getOrCreate(key: string, channel = "unknown"): Promise<Session> {
    let session = this.sessions.get(key);
    if (!session) {
      const history = this.store ? await this.store.loadSession(key) : [];
      session = {
        key,
        channel,
        history,
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

  async delete(key: string): Promise<boolean> {
    const existed = this.sessions.delete(key);
    if (this.store && existed) {
      await this.store.deleteSession(key);
    }
    return existed;
  }

  async clear(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (session) {
      session.history = [];
      session.updatedAt = new Date();
    }
    if (this.store) {
      await this.store.clearSession(key);
    }
  }

  /** Persist a single message to disk (no-op if no store configured). */
  async persist(key: string, message: ModelMessage, channel?: string): Promise<void> {
    if (this.store) {
      await this.store.saveMessage(key, message, channel);
    }
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  get size(): number {
    return this.sessions.size;
  }
}
