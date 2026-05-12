import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ModelMessage,
  ModelToolDefinition,
  ModelResponse,
  ModelToolCall,
  TokenUsage,
} from "../../../agent/types.js";

export class ClaudeProvider implements ModelProvider {
  name = "claude";
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = model ?? "claude-sonnet-4-5-20250929";
  }

  async chat(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
    system?: string;
    signal?: AbortSignal;
  }): Promise<ModelResponse> {
    const model = params.model ?? this.defaultModel;
    const system = params.system;

    // Convert messages to Claude format
    const claudeMessages: Anthropic.MessageParam[] = params.messages
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.tool_call_id ?? "",
                content: m.content,
              },
            ],
          };
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: "assistant" as const,
            content: [
              ...m.tool_calls.map((tc) => ({
                type: "tool_use" as const,
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })),
              ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
            ],
          };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        };
      });

    // Convert tools to Claude format
    const claudeTools: Anthropic.Tool[] | undefined = params.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    if (params.stream && params.onChunk) {
      const stream = this.client.messages.stream({
        model,
        max_tokens: 4096,
        ...(system ? { system } : {}),
        messages: claudeMessages,
        ...(claudeTools ? { tools: claudeTools } : {}),
      }, { signal: params.signal });

      let fullText = "";
      const toolCalls: ModelToolCall[] = [];

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullText += event.delta.text;
          params.onChunk(event.delta.text);
        }
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          // Accumulate tool use - will be in final message
        }
      }

      const finalMessage = await stream.finalMessage();

      for (const block of finalMessage.content) {
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        content: fullText,
        toolCalls,
        stopReason:
          finalMessage.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        usage: finalMessage.usage
          ? {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
              cacheCreationTokens: finalMessage.usage.cache_creation_input_tokens ?? undefined,
              cacheReadTokens: finalMessage.usage.cache_read_input_tokens ?? undefined,
            }
          : undefined,
      };
    }

    // Non-streaming
    const response = await this.client.messages.create({
      model,
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: claudeMessages,
      ...(claudeTools ? { tools: claudeTools } : {}),
    });

    let content = "";
    const toolCalls: ModelToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
            cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
          }
        : undefined,
    };
  }
}
