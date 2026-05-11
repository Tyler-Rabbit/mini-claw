import { readFile, writeFile, mkdir, unlink, truncate } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ModelMessage } from "../agent/types.js";

export interface SessionMeta {
  channel: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

type SessionIndex = Record<string, SessionMeta>;

/**
 * File-based session persistence layer.
 *
 * Storage layout:
 *   <storageDir>/sessions.json        — lightweight metadata index
 *   <storageDir>/<sanitized-key>.jsonl — one JSON line per ModelMessage
 *
 * All write operations use a per-session promise chain mutex to prevent
 * concurrent writes from corrupting data.
 */
export class SessionStore {
  private storageDir: string;
  private indexPath: string;
  private index: SessionIndex = {};
  private locks = new Map<string, Promise<void>>();

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    this.indexPath = join(storageDir, "sessions.json");
  }

  /** Create storage directory and load existing index. */
  async init(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    if (existsSync(this.indexPath)) {
      try {
        const raw = await readFile(this.indexPath, "utf-8");
        this.index = JSON.parse(raw);
      } catch {
        this.index = {};
      }
    } else {
      await this.flushIndex();
    }
  }

  /** Read all messages for a session from its .jsonl file. */
  async loadSession(key: string): Promise<ModelMessage[]> {
    const filePath = this.jsonlPath(key);
    if (!existsSync(filePath)) return [];

    const raw = await readFile(filePath, "utf-8");
    if (!raw.trim()) return [];

    const messages: ModelMessage[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
    return messages;
  }

  /**
   * Append a single message to a session's .jsonl file and update metadata.
   * Uses a promise chain mutex per session key to prevent concurrent writes.
   */
  async saveMessage(key: string, message: ModelMessage, channel = "unknown"): Promise<void> {
    // Chain onto the existing lock for this key
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.doSaveMessage(key, message, channel));
    this.locks.set(key, next);
    return next;
  }

  private async doSaveMessage(key: string, message: ModelMessage, channel: string): Promise<void> {
    const filePath = this.jsonlPath(key);
    const line = JSON.stringify(message) + "\n";
    await writeFile(filePath, line, { flag: "a" });

    const meta = this.index[key];
    if (meta) {
      meta.messageCount++;
      meta.updatedAt = new Date().toISOString();
    } else {
      this.index[key] = {
        channel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 1,
      };
    }
    await this.flushIndex();
  }

  /** Truncate a session's .jsonl file and reset its metadata. */
  async clearSession(key: string): Promise<void> {
    const filePath = this.jsonlPath(key);
    if (existsSync(filePath)) {
      await truncate(filePath, 0);
    }
    const meta = this.index[key];
    if (meta) {
      meta.messageCount = 0;
      meta.updatedAt = new Date().toISOString();
      await this.flushIndex();
    }
  }

  /** Remove a session's .jsonl file and its metadata entry. */
  async deleteSession(key: string): Promise<void> {
    const filePath = this.jsonlPath(key);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
    delete this.index[key];
    await this.flushIndex();
  }

  /** Return metadata for all sessions. */
  listSessions(): SessionIndex {
    return { ...this.index };
  }

  private jsonlPath(key: string): string {
    return join(this.storageDir, this.sanitize(key) + ".jsonl");
  }

  private sanitize(key: string): string {
    return key.replace(/\//g, "_");
  }

  private async flushIndex(): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify(this.index, null, 2) + "\n");
  }
}
