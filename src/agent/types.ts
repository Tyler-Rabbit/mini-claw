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
  role: "user" | "assistant" | "tool";
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
}

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
