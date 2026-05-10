import { describe, it, expect, beforeEach } from "vitest";
import { ChannelManager } from "../src/channels/manager.js";
import type { ChannelPlugin, ChannelDeps, InboundMessage } from "../src/channels/types.js";

class TestChannel implements ChannelPlugin {
  id = "test";
  meta = { id: "test", label: "Test", description: "Test channel" };
  started = false;
  stopped = false;
  lastDeps: ChannelDeps | null = null;

  async start(deps: ChannelDeps): Promise<void> {
    this.started = true;
    this.lastDeps = deps;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  simulateMessage(text: string): Promise<string> {
    if (!this.lastDeps) throw new Error("Channel not started");
    return this.lastDeps.onMessage({
      text,
      senderId: "test-user",
      channel: "test",
      sessionKey: "test/session",
      timestamp: new Date(),
    });
  }
}

describe("ChannelManager", () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager();
  });

  it("should register channels", () => {
    const channel = new TestChannel();
    manager.register(channel);

    expect(manager.size).toBe(1);
    expect(manager.has("test")).toBe(true);
    expect(manager.list()).toHaveLength(1);
  });

  it("should start all channels", async () => {
    const channel = new TestChannel();
    manager.register(channel);

    await manager.startAll({
      agent: {} as never,
      onMessage: async () => "ok",
    });

    expect(channel.started).toBe(true);
  });

  it("should stop all channels", async () => {
    const channel = new TestChannel();
    manager.register(channel);
    await manager.startAll({
      agent: {} as never,
      onMessage: async () => "ok",
    });

    await manager.stopAll();
    expect(channel.stopped).toBe(true);
  });

  it("should pass messages through onMessage handler", async () => {
    const received: InboundMessage[] = [];
    const channel = new TestChannel();
    manager.register(channel);

    await manager.startAll({
      agent: {} as never,
      onMessage: async (msg) => {
        received.push(msg);
        return `echo: ${msg.text}`;
      },
    });

    const response = await channel.simulateMessage("hello");

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe("hello");
    expect(response).toBe("echo: hello");
  });
});
