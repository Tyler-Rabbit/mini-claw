import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../src/agent/tool-registry.js";
import { echoTool } from "../src/agent/tools/echo.js";
import { calculatorTool } from "../src/agent/tools/calculator.js";
import type { ModelProvider, ModelMessage, ModelToolDefinition, ModelResponse } from "../src/agent/types.js";
import type { AgentStreamEvent } from "../src/agent/types.js";
import { ModelRouter } from "../src/agent/model-router.js";
import { SessionManager } from "../src/sessions/manager.js";
import { AgentRuntime } from "../src/agent/runtime.js";

// Mock model provider that returns fixed responses
class MockProvider implements ModelProvider {
  name = "mock";
  private responses: ModelResponse[] = [];
  private callIndex = 0;

  setResponses(responses: ModelResponse[]): void {
    this.responses = responses;
    this.callIndex = 0;
  }

  async chat(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
  }): Promise<ModelResponse> {
    const response = this.responses[this.callIndex] ?? {
      content: "Mock response",
      toolCalls: [],
      stopReason: "end_turn" as const,
    };
    this.callIndex++;

    if (params.stream && params.onChunk && response.content) {
      params.onChunk(response.content);
    }

    return response;
  }
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("should register and list tools", () => {
    registry.register(echoTool);
    registry.register(calculatorTool);

    expect(registry.list()).toHaveLength(2);
    expect(registry.has("echo")).toBe(true);
    expect(registry.has("calculator")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
  });

  it("should convert tools to model definitions", () => {
    registry.register(echoTool);
    const defs = registry.toModelDefinitions();

    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe("echo");
    expect(defs[0].description).toContain("Echo");
    expect(defs[0].parameters).toBeDefined();
  });

  it("should execute echo tool", async () => {
    registry.register(echoTool);
    const result = await registry.execute(
      "echo",
      { text: "hello" },
      { sessionKey: "test", channel: "test", senderId: "test" }
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("Echo: hello");
  });

  it("should execute calculator tool", async () => {
    registry.register(calculatorTool);

    const add = await registry.execute(
      "calculator",
      { operation: "add", a: 5, b: 3 },
      { sessionKey: "test", channel: "test", senderId: "test" }
    );
    expect(add.content).toBe("5 add 3 = 8");

    const div = await registry.execute(
      "calculator",
      { operation: "divide", a: 10, b: 2 },
      { sessionKey: "test", channel: "test", senderId: "test" }
    );
    expect(div.content).toBe("10 divide 2 = 5");
  });

  it("should handle division by zero", async () => {
    registry.register(calculatorTool);
    const result = await registry.execute(
      "calculator",
      { operation: "divide", a: 1, b: 0 },
      { sessionKey: "test", channel: "test", senderId: "test" }
    );
    expect(result.type).toBe("error");
    expect(result.content).toContain("Division by zero");
  });

  it("should return error for unknown tool", async () => {
    const result = await registry.execute(
      "nonexistent",
      {},
      { sessionKey: "test", channel: "test", senderId: "test" }
    );
    expect(result.type).toBe("error");
    expect(result.content).toContain("Tool not found");
  });
});

describe("AgentRuntime", () => {
  it("should handle simple text response (no tools)", async () => {
    const mockProvider = new MockProvider();
    mockProvider.setResponses([
      { content: "Hello! How can I help?", toolCalls: [], stopReason: "end_turn" },
    ]);

    const router = new ModelRouter();
    router.registerProvider(mockProvider);

    const toolRegistry = new ToolRegistry();
    const sessionManager = new SessionManager();

    const agent = new AgentRuntime({
      modelRouter: router,
      toolRegistry,
      sessionManager,
      defaultProvider: "mock",
    });

    const events: AgentStreamEvent[] = [];
    const result = await agent.run(
      { message: "Hi", sessionKey: "test-1" },
      (e) => events.push(e)
    );

    expect(result).toBe("Hello! How can I help?");
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("should handle tool calls and return final text", async () => {
    const mockProvider = new MockProvider();
    mockProvider.setResponses([
      // First call: model wants to use a tool
      {
        content: "",
        toolCalls: [
          { id: "tc-1", name: "echo", arguments: { text: "test" } },
        ],
        stopReason: "tool_use",
      },
      // Second call: model returns final text
      { content: "The echo said: Echo: test", toolCalls: [], stopReason: "end_turn" },
    ]);

    const router = new ModelRouter();
    router.registerProvider(mockProvider);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(echoTool);

    const sessionManager = new SessionManager();

    const agent = new AgentRuntime({
      modelRouter: router,
      toolRegistry,
      sessionManager,
      defaultProvider: "mock",
    });

    const events: AgentStreamEvent[] = [];
    const result = await agent.run(
      { message: "echo test", sessionKey: "test-2" },
      (e) => events.push(e)
    );

    expect(result).toBe("The echo said: Echo: test");
    expect(events.some((e) => e.type === "tool_use" && e.toolName === "echo")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("should maintain session history", async () => {
    const mockProvider = new MockProvider();
    mockProvider.setResponses([
      { content: "First response", toolCalls: [], stopReason: "end_turn" },
    ]);

    const router = new ModelRouter();
    router.registerProvider(mockProvider);

    const sessionManager = new SessionManager();
    const agent = new AgentRuntime({
      modelRouter: router,
      toolRegistry: new ToolRegistry(),
      sessionManager,
      defaultProvider: "mock",
    });

    await agent.runSimple("Hello", "session-test");

    const session = sessionManager.get("session-test");
    expect(session).toBeDefined();
    expect(session!.history.length).toBeGreaterThanOrEqual(2); // user + assistant
  });
});
