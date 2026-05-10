import OpenAI from "openai";
export class OpenAIProvider {
    name = "openai";
    client;
    defaultModel;
    constructor(apiKey, model) {
        this.client = new OpenAI({ apiKey });
        this.defaultModel = model ?? "gpt-4o";
    }
    async chat(params) {
        const model = params.model ?? this.defaultModel;
        const oaiMessages = params.messages.map((m) => {
            if (m.role === "tool") {
                return {
                    role: "tool",
                    content: m.content,
                    tool_call_id: m.tool_call_id ?? "",
                };
            }
            if (m.tool_calls && m.tool_calls.length > 0) {
                return {
                    role: "assistant",
                    content: m.content || null,
                    tool_calls: m.tool_calls.map((tc) => ({
                        id: tc.id,
                        type: "function",
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments),
                        },
                    })),
                };
            }
            return { role: m.role, content: m.content };
        });
        const oaiTools = params.tools?.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
        if (params.stream && params.onChunk) {
            const stream = await this.client.chat.completions.create({
                model,
                messages: oaiMessages,
                ...(oaiTools ? { tools: oaiTools } : {}),
                stream: true,
            });
            let fullText = "";
            const toolCallAccumulator = new Map();
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
                        const acc = toolCallAccumulator.get(idx);
                        if (tc.id)
                            acc.id = tc.id;
                        if (tc.function?.name)
                            acc.name = tc.function.name;
                        if (tc.function?.arguments)
                            acc.arguments += tc.function.arguments;
                    }
                }
            }
            const toolCalls = [...toolCallAccumulator.values()].map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: this.safeParse(tc.arguments),
            }));
            return {
                content: fullText,
                toolCalls,
                stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
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
        const toolCalls = message?.tool_calls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: this.safeParse(tc.function.arguments),
        })) ?? [];
        return {
            content,
            toolCalls,
            stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        };
    }
    safeParse(json) {
        try {
            return JSON.parse(json);
        }
        catch {
            return {};
        }
    }
}
