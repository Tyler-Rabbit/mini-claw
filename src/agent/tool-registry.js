export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    has(name) {
        return this.tools.has(name);
    }
    list() {
        return [...this.tools.values()];
    }
    toModelDefinitions() {
        return [...this.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        }));
    }
    async execute(name, args, context) {
        const tool = this.tools.get(name);
        if (!tool) {
            return { type: "error", content: `Tool not found: ${name}` };
        }
        try {
            const result = await tool.execute({ args, context });
            return { type: result.type, content: result.content };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return { type: "error", content: `Tool execution failed: ${message}` };
        }
    }
}
