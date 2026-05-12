import type { CompactionConfig, ModelMessage, TokenUsage } from "./types.js";
import type { ModelRouter } from "./model-router.js";

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

  /** Split messages into system, to-summarize, and to-keep groups. */
  splitMessages(messages: ModelMessage[]): {
    systemMessages: ModelMessage[];
    toSummarize: ModelMessage[];
    toKeep: ModelMessage[];
  } {
    const systemMessages: ModelMessage[] = [];
    const nonSystem: ModelMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg);
      } else {
        nonSystem.push(msg);
      }
    }

    const keepCount = Math.min(this.config.keepRecentMessages, nonSystem.length);
    const toKeep = nonSystem.slice(nonSystem.length - keepCount);
    const toSummarize = nonSystem.slice(0, nonSystem.length - keepCount);

    return { systemMessages, toSummarize, toKeep };
  }

  /** Compact conversation history into a summary. Returns new message array. */
  async compact(
    sessionKey: string,
    messages: ModelMessage[],
    modelRouter: ModelRouter,
    instruction?: string
  ): Promise<ModelMessage[]> {
    const { systemMessages, toSummarize, toKeep } = this.splitMessages(messages);

    if (toSummarize.length === 0) {
      return [...messages];
    }

    const state = this.getState(sessionKey);

    // Find existing summary in system messages for rolling updates
    const existingSummary = systemMessages.find(
      (m) => m.content.startsWith("[Compacted Summary]")
    );

    const summaryText = await this.summarize(
      toSummarize,
      modelRouter,
      existingSummary?.content,
      instruction
    );

    // Strip previous summary from system messages (we'll replace it)
    const baseSystemMessages = systemMessages.filter(
      (m) => !m.content.startsWith("[Compacted Summary]")
    );

    const summaryMsg: ModelMessage = {
      role: "system",
      content: `[Compacted Summary]\n${summaryText}`,
    };

    // Reset state after compaction
    this.resetSession(sessionKey);
    // Mark that we now have a summary
    const newState = this.getState(sessionKey);
    newState.hasSummary = true;

    return [...baseSystemMessages, summaryMsg, ...toKeep];
  }

  private async summarize(
    messages: ModelMessage[],
    modelRouter: ModelRouter,
    existingSummary?: string,
    instruction?: string
  ): Promise<string> {
    const messagesText = messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");

    let prompt = this.config.summaryPrompt;
    if (instruction) {
      prompt += `\n\nAdditional instruction: ${instruction}`;
    }

    const summaryRequest: ModelMessage[] = [];

    if (existingSummary) {
      summaryRequest.push({
        role: "user",
        content: `Previous summary:\n${existingSummary.replace("[Compacted Summary]\n", "")}\n\nNew messages to incorporate:\n${messagesText}\n\n${prompt}`,
      });
    } else {
      summaryRequest.push({
        role: "user",
        content: `${messagesText}\n\n${prompt}`,
      });
    }

    const response = await modelRouter.chat({
      messages: summaryRequest,
      stream: false,
    });

    return response.content;
  }
}
