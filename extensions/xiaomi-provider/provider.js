import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
export class XiaomiProvider {
    name = "xiaomi";
    protocol;
    oaiClient = null;
    anthropicClient = null;
    defaultModel;
    baseUrl;
    constructor(options) {
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
        }
        else {
            this.oaiClient = new OpenAI({
                apiKey: options.apiKey,
                baseURL: this.baseUrl,
            });
        }
    }
    async chat(params) {
        return this.protocol === "anthropic"
            ? this.chatAnthropic(params)
            : this.chatOpenAI(params);
    }
    // --- OpenAI-compatible path ---
    async chatOpenAI(params) {
        const model = params.model ?? this.defaultModel;
        const client = this.oaiClient;
        const oaiMessages = this.toOpenAIMessages(params.messages);
        const oaiTools = this.toOpenAITools(params.tools);
        if (params.stream && params.onChunk) {
            const stream = await client.chat.completions.create({
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
        const response = await client.chat.completions.create({
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
    // --- Anthropic-compatible path ---
    async chatAnthropic(params) {
        const model = params.model ?? this.defaultModel;
        const client = this.anthropicClient;
        const systemMsg = params.messages.find((m) => m.role === "user" && m.content.startsWith("system:"));
        const system = systemMsg?.content.replace("system:", "").trim();
        const claudeMessages = params.messages
            .filter((m) => m.role !== "tool" || !m.content.startsWith("system:"))
            .map((m) => {
            if (m.role === "tool") {
                return {
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: m.tool_call_id ?? "",
                            content: m.content,
                        },
                    ],
                };
            }
            if (m.tool_calls && m.tool_calls.length > 0) {
                return {
                    role: "assistant",
                    content: [
                        ...m.tool_calls.map((tc) => ({
                            type: "tool_use",
                            id: tc.id,
                            name: tc.name,
                            input: tc.arguments,
                        })),
                        ...(m.content
                            ? [{ type: "text", text: m.content }]
                            : []),
                    ],
                };
            }
            return {
                role: m.role,
                content: m.content,
            };
        });
        const claudeTools = params.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
        }));
        if (params.stream && params.onChunk) {
            const stream = client.messages.stream({
                model,
                max_tokens: 4096,
                ...(system ? { system } : {}),
                messages: claudeMessages,
                ...(claudeTools ? { tools: claudeTools } : {}),
            });
            let fullText = "";
            const toolCalls = [];
            for await (const event of stream) {
                if (event.type === "content_block_delta" &&
                    event.delta.type === "text_delta") {
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
                        arguments: block.input,
                    });
                }
            }
            return {
                content: fullText,
                toolCalls,
                stopReason: finalMessage.stop_reason === "tool_use" ? "tool_use" : "end_turn",
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
        const toolCalls = [];
        for (const block of response.content) {
            if (block.type === "text") {
                content += block.text;
            }
            else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    arguments: block.input,
                });
            }
        }
        return {
            content,
            toolCalls,
            stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        };
    }
    // --- Helpers ---
    toOpenAIMessages(messages) {
        return messages.map((m) => {
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
    }
    toOpenAITools(tools) {
        return tools?.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
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
