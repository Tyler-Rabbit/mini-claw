export class AgentRuntime {
    modelRouter;
    toolRegistry;
    sessionManager;
    maxToolRounds;
    defaultProvider;
    defaultModel;
    constructor(options) {
        this.modelRouter = options.modelRouter;
        this.toolRegistry = options.toolRegistry;
        this.sessionManager = options.sessionManager;
        this.maxToolRounds = options.maxToolRounds ?? 5;
        this.defaultProvider = options.defaultProvider ?? "claude";
        this.defaultModel = options.defaultModel ?? "";
    }
    async run(options, onEvent) {
        const { message, sessionKey, channel = "cli", senderId = "local", model, history, } = options;
        // Get or create session history
        const session = this.sessionManager.getOrCreate(sessionKey);
        const messages = [
            ...(history ?? session.history),
            { role: "user", content: message },
        ];
        // Save user message
        session.history.push({ role: "user", content: message });
        const tools = this.toolRegistry.toModelDefinitions();
        let round = 0;
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
            // If no tool calls, we're done
            if (response.toolCalls.length === 0) {
                const assistantMsg = {
                    role: "assistant",
                    content: response.content,
                };
                messages.push(assistantMsg);
                session.history.push(assistantMsg);
                onEvent?.({ type: "done" });
                return response.content;
            }
            // Handle tool calls
            const assistantMsg = {
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
                const result = await this.toolRegistry.execute(toolCall.name, toolCall.arguments, { sessionKey, channel, senderId });
                onEvent?.({
                    type: "tool_result",
                    toolName: toolCall.name,
                    toolResult: result.content,
                    toolCallId: toolCall.id,
                });
                const toolMsg = {
                    role: "tool",
                    content: result.content,
                    tool_call_id: toolCall.id,
                };
                messages.push(toolMsg);
                session.history.push(toolMsg);
            }
        }
        // Max rounds exceeded
        const fallback = "I've reached the maximum number of tool execution rounds.";
        onEvent?.({ type: "error", content: fallback });
        onEvent?.({ type: "done" });
        return fallback;
    }
    async runSimple(message, sessionKey) {
        return this.run({ message, sessionKey });
    }
}
