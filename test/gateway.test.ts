import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { GatewayServer } from "../src/gateway/server.js";
import type { ResponseFrame, EventFrame } from "../src/gateway/protocol/types.js";

function waitForMessage(ws: WebSocket, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("Gateway", () => {
  let gateway: GatewayServer;
  const port = 19999; // Use a different port for tests

  beforeAll(async () => {
    gateway = new GatewayServer();

    // Register a test method
    gateway.getRouter().register("ping", (ctx) => {
      ctx.send({
        type: "res",
        id: (ctx.params as { id: string }).id,
        ok: true,
        payload: { pong: true },
      });
    });

    // Register agent-like method
    gateway.getRouter().register("echo", (ctx) => {
      const params = ctx.params as { message: string; id: string };
      ctx.send({
        type: "res",
        id: params.id,
        ok: true,
        payload: { echo: params.message },
      });
    });

    await gateway.start({ port, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await gateway.stop();
  });

  it("should accept WebSocket connections", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Send connect frame
    ws.send(
      JSON.stringify({
        type: "req",
        id: "conn-1",
        method: "connect",
        params: { role: "client", deviceId: "test-1" },
      })
    );

    const msg = (await waitForMessage(ws)) as ResponseFrame;
    expect(msg.type).toBe("res");
    expect(msg.ok).toBe(true);
    expect(msg.id).toBe("conn-1");

    ws.close();
  });

  it("should reject non-connect frames before connection", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    ws.send(
      JSON.stringify({
        type: "req",
        id: "bad-1",
        method: "ping",
        params: {},
      })
    );

    const msg = (await waitForMessage(ws)) as ResponseFrame;
    expect(msg.ok).toBe(false);
    expect(msg.error?.code).toBe("NOT_CONNECTED");

    ws.close();
  });

  it("should route requests to registered handlers", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Connect first
    ws.send(
      JSON.stringify({
        type: "req",
        id: "conn-2",
        method: "connect",
        params: { role: "client", deviceId: "test-2" },
      })
    );
    await waitForMessage(ws); // consume connect response

    // Send ping
    ws.send(
      JSON.stringify({
        type: "req",
        id: "ping-1",
        method: "ping",
        params: {},
      })
    );

    const msg = (await waitForMessage(ws)) as ResponseFrame;
    expect(msg.type).toBe("res");
    expect(msg.ok).toBe(true);
    expect((msg.payload as { pong: boolean }).pong).toBe(true);

    ws.close();
  });

  it("should return error for unknown methods", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on("open", resolve));

    // Connect
    ws.send(
      JSON.stringify({
        type: "req",
        id: "conn-3",
        method: "connect",
        params: { role: "client", deviceId: "test-3" },
      })
    );
    await waitForMessage(ws);

    // Unknown method
    ws.send(
      JSON.stringify({
        type: "req",
        id: "unknown-1",
        method: "nonexistent",
        params: {},
      })
    );

    const msg = (await waitForMessage(ws)) as ResponseFrame;
    expect(msg.ok).toBe(false);
    expect(msg.error?.code).toBe("METHOD_NOT_FOUND");

    ws.close();
  });
});
