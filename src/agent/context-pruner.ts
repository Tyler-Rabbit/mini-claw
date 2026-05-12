import type { ModelMessage, ContextPrunerConfig } from "./types.js";

interface SessionState {
  lastPruneTime: number;
  lastMessageCount: number;
}

export class ContextPruner {
  private config: ContextPrunerConfig;
  private sessions: Map<string, SessionState> = new Map();

  constructor(config: ContextPrunerConfig) {
    this.config = config;
  }

  prune(sessionKey: string, messages: ModelMessage[], now?: number): ModelMessage[] {
    if (this.config.mode === "off") {
      return [...messages];
    }

    const currentTime = now ?? Date.now();
    const state = this.sessions.get(sessionKey);

    // First call for this session: initialize state, prune all tool results
    if (!state) {
      this.sessions.set(sessionKey, {
        lastPruneTime: currentTime,
        lastMessageCount: messages.length,
      });
      return this.pruneToolResults(messages, 0, messages.length);
    }

    // TTL not expired: skip pruning
    if (currentTime - state.lastPruneTime < this.config.ttl) {
      // Update message count to track new messages
      this.sessions.set(sessionKey, {
        ...state,
        lastMessageCount: messages.length,
      });
      return [...messages];
    }

    // TTL expired: prune tool results from previous rounds
    const pruneUpTo = state.lastMessageCount;
    this.sessions.set(sessionKey, {
      lastPruneTime: currentTime,
      lastMessageCount: messages.length,
    });
    return this.pruneToolResults(messages, 0, pruneUpTo);
  }

  private pruneToolResults(messages: ModelMessage[], fromIndex: number, toIndex: number): ModelMessage[] {
    return messages.map((msg, i) => {
      // Only prune tool messages within the specified range
      if (msg.role !== "tool" || i < fromIndex || i >= toIndex) {
        return { ...msg };
      }

      // Soft trim for large content
      if (msg.content.length > this.config.softTrimThreshold) {
        return {
          ...msg,
          content: this.softTrim(msg.content),
        };
      }

      // Hard prune for small content
      return {
        ...msg,
        content: this.config.hardPrunePlaceholder,
      };
    });
  }

  private softTrim(content: string): string {
    const head = content.slice(0, this.config.softTrimHead);
    const tail = content.slice(-this.config.softTrimTail);
    const totalChars = content.length;
    return `${head}...[pruned ${totalChars} chars total]...${tail}`;
  }
}
