import type {
  AgentRunOptions,
  ModelMessage,
  StreamCallback,
  TokenUsage,
} from "./types.js";
import type { ModelRouter } from "./model-router.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { SessionManager } from "../sessions/manager.js";

export interface AgentRuntimeOptions {
  modelRouter: ModelRouter;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  maxToolRounds?: number;
  defaultProvider?: string;
  defaultModel?: string;
}

export class AgentRuntime {
  private modelRouter: ModelRouter;
  private toolRegistry: ToolRegistry;
  private sessionManager: SessionManager;
  private maxToolRounds: number;
  private defaultProvider: string;
  private defaultModel: string;

  constructor(options: AgentRuntimeOptions) {
    this.modelRouter = options.modelRouter;
    this.toolRegistry = options.toolRegistry;
    this.sessionManager = options.sessionManager;
    this.maxToolRounds = options.maxToolRounds ?? 20;
    this.defaultProvider = options.defaultProvider ?? "claude";
    this.defaultModel = options.defaultModel ?? "";
  }

  async run(
    options: AgentRunOptions,
    onEvent?: StreamCallback
  ): Promise<string> {
    const {
      message,
      sessionKey,
      channel = "cli",
      senderId = "local",
      model,
      history,
    } = options;

    // Get or create session history
    const session = this.sessionManager.getOrCreate(sessionKey);
    const messages: ModelMessage[] = [
      ...(history ?? session.history),
      { role: "user", content: message },
    ];

    // Save user message
    session.history.push({ role: "user", content: message });

    const tools = this.toolRegistry.toModelDefinitions();
    let round = 0;
    const startTime = Date.now();
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    const addUsage = (u?: TokenUsage) => {
      if (!u) return;
      totalUsage.inputTokens += u.inputTokens;
      totalUsage.outputTokens += u.outputTokens;
      totalUsage.cacheCreationTokens =
        (totalUsage.cacheCreationTokens ?? 0) + (u.cacheCreationTokens ?? 0);
      totalUsage.cacheReadTokens =
        (totalUsage.cacheReadTokens ?? 0) + (u.cacheReadTokens ?? 0);
    };

    while (round < this.maxToolRounds) {
      round++;

      const response = await this.modelRouter.chat({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        model: model || this.defaultModel || undefined,
        provider: this.defaultProvider,
        stream: true,
        onChunk: (text) => {
          onEvent?.({ type: "text", content: text });
        },
      });

      // Emit per-round usage so the UI can show real-time token counts
      addUsage(response.usage);
      if (response.usage) {
        onEvent?.({ type: "usage", usage: totalUsage });
      }

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        const assistantMsg: ModelMessage = {
          role: "assistant",
          content: response.content,
        };
        messages.push(assistantMsg);
        session.history.push(assistantMsg);

        onEvent?.({
          type: "done",
          usage: totalUsage,
          durationMs: Date.now() - startTime,
        });
        return response.content;
      }

      // Handle tool calls
      const assistantMsg: ModelMessage = {
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls,
      };
      messages.push(assistantMsg);
      session.history.push(assistantMsg);

      // Execute each tool and add results
      for (const toolCall of response.toolCalls) {
        onEvent?.({
          type: "tool_use",
          toolName: toolCall.name,
          toolArgs: toolCall.arguments,
          toolCallId: toolCall.id,
        });

        const result = await this.toolRegistry.execute(
          toolCall.name,
          toolCall.arguments,
          { sessionKey, channel, senderId }
        );

        onEvent?.({
          type: "tool_result",
          toolName: toolCall.name,
          toolResult: result.content,
          toolCallId: toolCall.id,
        });

        const toolMsg: ModelMessage = {
          role: "tool",
          content: result.content,
          tool_call_id: toolCall.id,
        };
        messages.push(toolMsg);
        session.history.push(toolMsg);
      }
    }

    // Max rounds exceeded — do a final model call without tools so it can summarize
    const finalMessages: ModelMessage[] = [
      ...messages,
      {
        role: "user",
        content:
          "You have reached the tool execution limit. Do NOT attempt to call any tools. Based on the information gathered so far, provide your best response to the user's original question using plain text only.",
      },
    ];

    const finalResponse = await this.modelRouter.chat({
      messages: finalMessages,
      // No tools — forces a text response
      model: model || this.defaultModel || undefined,
      provider: this.defaultProvider,
      stream: true,
      onChunk: (text) => {
        onEvent?.({ type: "text", content: text });
      },
    });

    addUsage(finalResponse.usage);

    const assistantMsg: ModelMessage = {
      role: "assistant",
      content: finalResponse.content,
    };
    messages.push(assistantMsg);
    session.history.push(assistantMsg);

    onEvent?.({ type: "usage", usage: totalUsage });
    onEvent?.({
      type: "done",
      usage: totalUsage,
      durationMs: Date.now() - startTime,
    });
    return finalResponse.content;
  }

  async runSimple(message: string, sessionKey: string): Promise<string> {
    return this.run({ message, sessionKey });
  }
}
