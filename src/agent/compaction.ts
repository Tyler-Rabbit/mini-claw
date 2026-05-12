import type { CompactionConfig, TokenUsage } from "./types.js";

interface SessionState {
  messageCount: number;
  inputTokens: number;
  compactedUpTo: number;
  hasSummary: boolean;
}

export class CompactionModule {
  private config: CompactionConfig;
  private sessions: Map<string, SessionState> = new Map();

  constructor(config: CompactionConfig) {
    this.config = config;
  }

  private getState(sessionKey: string): SessionState {
    let state = this.sessions.get(sessionKey);
    if (!state) {
      state = { messageCount: 0, inputTokens: 0, compactedUpTo: 0, hasSummary: false };
      this.sessions.set(sessionKey, state);
    }
    return state;
  }

  /** Record that a model response happened (call after each round). */
  recordUsage(sessionKey: string, usage: TokenUsage): void {
    const state = this.getState(sessionKey);
    state.messageCount++;
    state.inputTokens += usage.inputTokens;
  }

  /** Check if compaction should trigger. */
  needsCompaction(sessionKey: string, _totalUsage: TokenUsage): boolean {
    if (!this.config.enabled) return false;
    const state = this.getState(sessionKey);
    return (
      state.messageCount >= this.config.maxMessages ||
      state.inputTokens >= this.config.maxInputTokens
    );
  }

  /** Reset session state (called after compaction completes). */
  resetSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }
}
