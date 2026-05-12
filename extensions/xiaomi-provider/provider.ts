import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ModelMessage,
  ModelToolDefinition,
  ModelResponse,
  ModelToolCall,
  TokenUsage,
} from "../../src/agent/types.js";

export type XiaomiProtocol = "openai" | "anthropic";

export interface XiaomiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  protocol?: XiaomiProtocol;
}

export class XiaomiProvider implements ModelProvider {
  name = "xiaomi";
  private protocol: XiaomiProtocol;
  private oaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private defaultModel: string;
  private baseUrl: string;

  constructor(options: XiaomiProviderOptions) {
    this.protocol = options.protocol ?? "openai";
    this.defaultModel = options.model ?? "MiMo-7B";
    this.baseUrl = options.baseUrl ?? (this.protocol === "anthropic"
      ? "https://api.xiaomimimo.com/anthropic"
      : "https://api.xiaomimimo.com/v1");

    if (this.protocol === "anthropic") {
      this.anthropicClient = new Anthropic({
        apiKey: options.apiKey,
        baseURL: this.baseUrl,
      });
    } else {
      this.oaiClient = new OpenAI({
        apiKey: options.apiKey,
        baseURL: this.baseUrl,
      });
    }
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
    return this.protocol === "anthropic"
      ? this.chatAnthropic(params)
      : this.chatOpenAI(params);
  }

  // --- OpenAI-compatible path ---

  private async chatOpenAI(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
    system?: string;
    signal?: AbortSignal;
  }): Promise<ModelResponse> {
    const model = params.model ?? this.defaultModel;
    const client = this.oaiClient!;

    const oaiMessages = [
      ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
      ...this.toOpenAIMessages(params.messages),
    ];
    const oaiTools = this.toOpenAITools(params.tools);

    if (params.stream && params.onChunk) {
      const stream = await client.chat.completions.create({
        model,
        messages: oaiMessages,
        ...(oaiTools ? { tools: oaiTools } : {}),
        stream: true,
      }, { signal: params.signal });

      let fullText = "";
      let usage: TokenUsage | undefined;
      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          fullText += delta.content;
          params.onChunk(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulator.has(idx)) {
              toolCallAccumulator.set(idx, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                arguments: "",
              });
            }
            const acc = toolCallAccumulator.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
      }

      const toolCalls: ModelToolCall[] = [...toolCallAccumulator.values()].map(
        (tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: this.safeParse(tc.arguments),
        })
      );

      return {
        content: fullText,
        toolCalls,
        stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
        usage,
      };
    }

    // Non-streaming
    const response = await client.chat.completions.create({
      model,
      messages: oaiMessages,
      ...(oaiTools ? { tools: oaiTools } : {}),
    });

    const choice = response.choices[0];
    const message = choice?.message;

    let content = message?.content ?? "";
    const toolCalls: ModelToolCall[] =
      message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.safeParse(tc.function.arguments),
      })) ?? [];

    return {
      content,
      toolCalls,
      stopReason:
        choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }

  // --- Anthropic-compatible path ---

  private async chatAnthropic(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
    system?: string;
    signal?: AbortSignal;
  }): Promise<ModelResponse> {
    const model = params.model ?? this.defaultModel;
    const client = this.anthropicClient!;
    const system = params.system;

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
              ...(m.content
                ? [{ type: "text" as const, text: m.content }]
                : []),
            ],
          };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        };
      });

    const claudeTools: Anthropic.Tool[] | undefined = params.tools?.map(
      (t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      })
    );

    if (params.stream && params.onChunk) {
      const stream = client.messages.stream({
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
    const response = await client.messages.create({
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

  // --- Helpers ---

  private toOpenAIMessages(
    messages: ModelMessage[]
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? "",
        };
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  private toOpenAITools(
    tools?: ModelToolDefinition[]
  ): OpenAI.ChatCompletionTool[] | undefined {
    return tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private safeParse(json: string): Record<string, unknown> {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
}
