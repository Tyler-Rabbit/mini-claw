import OpenAI from "openai";
import type {
  ModelProvider,
  ModelMessage,
  ModelToolDefinition,
  ModelResponse,
  ModelToolCall,
  TokenUsage,
} from "../../../agent/types.js";

export class OpenAIProvider implements ModelProvider {
  name = "openai";
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.defaultModel = model ?? "gpt-4o";
  }

  async chat(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
  }): Promise<ModelResponse> {
    const model = params.model ?? this.defaultModel;

    const oaiMessages: OpenAI.ChatCompletionMessageParam[] = params.messages.map(
      (m) => {
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
      }
    );

    const oaiTools: OpenAI.ChatCompletionTool[] | undefined = params.tools?.map(
      (t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })
    );

    if (params.stream && params.onChunk) {
      const stream = await this.client.chat.completions.create({
        model,
        messages: oaiMessages,
        ...(oaiTools ? { tools: oaiTools } : {}),
        stream: true,
      });

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
    const response = await this.client.chat.completions.create({
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

  private safeParse(json: string): Record<string, unknown> {
    try {
      return JSON.parse(json);
    } catch {
      return {};
    }
  }
}
