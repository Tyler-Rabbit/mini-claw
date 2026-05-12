import type { TSchema } from "@sinclair/typebox";

export interface ToolResult {
  type: "text" | "error" | "json";
  content: string;
  data?: Record<string, unknown>;
}

export interface ToolContext {
  sessionKey: string;
  channel: string;
  senderId: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: TSchema;
  execute: (params: {
    args: Record<string, unknown>;
    context: ToolContext;
  }) => Promise<ToolResult> | ToolResult;
}

export interface ModelMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentRunOptions {
  message: string;
  sessionKey: string;
  channel?: string;
  senderId?: string;
  model?: string;
  history?: ModelMessage[];
  signal?: AbortSignal;
}

export interface ContextPrunerConfig {
  mode: "cache-ttl" | "off";
  ttl: number;
  softTrimThreshold: number;
  softTrimHead: number;
  softTrimTail: number;
  hardPrunePlaceholder: string;
}

export const DEFAULT_CONTEXT_PRUNER_CONFIG: ContextPrunerConfig = {
  mode: "cache-ttl",
  ttl: 5 * 60 * 1000,
  softTrimThreshold: 2000,
  softTrimHead: 500,
  softTrimTail: 500,
  hardPrunePlaceholder: "[tool result pruned - old output]",
};

export interface CompactionConfig {
  enabled: boolean;
  maxMessages: number;
  maxInputTokens: number;
  keepRecentMessages: number;
  summaryPrompt: string;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  maxMessages: 50,
  maxInputTokens: 100_000,
  keepRecentMessages: 0,
  summaryPrompt: `You are a conversation summarizer. Produce a concise summary of the conversation below.
Preserve:
- Key decisions and their reasoning
- User preferences and constraints
- Important tool results (data, errors, configurations)
- Open questions or unfinished tasks

Omit:
- Routine tool calls with no lasting significance
- Repeated or redundant information
- Boilerplate and formatting

The summary will be used as context for continuing the conversation.`,
};

export interface AgentStreamEvent {
  type: "text" | "tool_use" | "tool_result" | "error" | "done" | "usage";
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolCallId?: string;
  usage?: TokenUsage;
  durationMs?: number;
}

export type StreamCallback = (event: AgentStreamEvent) => void;

export interface ModelProvider {
  name: string;
  chat(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
    system?: string;
    signal?: AbortSignal;
  }): Promise<ModelResponse>;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export interface ModelResponse {
  content: string;
  toolCalls: ModelToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: TokenUsage;
}
