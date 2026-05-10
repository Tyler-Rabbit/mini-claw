import type { AgentTool, ModelToolDefinition } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  toModelDefinitions(): ModelToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    }));
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: { sessionKey: string; channel: string; senderId: string }
  ): Promise<{ type: string; content: string }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { type: "error", content: `Tool not found: ${name}` };
    }
    try {
      const result = await tool.execute({ args, context });
      return { type: result.type, content: result.content };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { type: "error", content: `Tool execution failed: ${message}` };
    }
  }
}
