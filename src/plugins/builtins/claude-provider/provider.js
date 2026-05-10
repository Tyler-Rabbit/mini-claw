import Anthropic from "@anthropic-ai/sdk";
export class ClaudeProvider {
    name = "claude";
    client;
    defaultModel;
    constructor(apiKey, model) {
        this.client = new Anthropic({ apiKey });
        this.defaultModel = model ?? "claude-sonnet-4-5-20250929";
    }
    async chat(params) {
        const model = params.model ?? this.defaultModel;
        // Convert messages to Claude format
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
                        ...(m.content ? [{ type: "text", text: m.content }] : []),
                    ],
                };
            }
            return {
                role: m.role,
                content: m.content,
            };
        });
        // Convert tools to Claude format
        const claudeTools = params.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
        }));
        if (params.stream && params.onChunk) {
            const stream = this.client.messages.stream({
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
                if (event.type === "content_block_start" &&
                    event.content_block.type === "tool_use") {
                    // Accumulate tool use - will be in final message
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
        const response = await this.client.messages.create({
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
}
