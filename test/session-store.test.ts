import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/sessions/store.js";
import { SessionManager } from "../src/sessions/manager.js";

let tmpDir: string;
let store: SessionStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "session-store-test-"));
  store = new SessionStore(tmpDir);
  await store.init();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("should create storage directory and empty index on init", async () => {
    const files = await readdir(tmpDir);
    expect(files).toContain("sessions.json");

    const raw = await readFile(join(tmpDir, "sessions.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({});
  });

  it("should save and load messages", async () => {
    const msg1 = { role: "user" as const, content: "hello" };
    const msg2 = { role: "assistant" as const, content: "hi there" };

    await store.saveMessage("test/key", msg1, "cli");
    await store.saveMessage("test/key", msg2);

    const messages = await store.loadSession("test/key");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(msg1);
    expect(messages[1]).toEqual(msg2);
  });

  it("should update sessions.json metadata", async () => {
    await store.saveMessage("s1", { role: "user", content: "a" }, "cli");

    const sessions = store.listSessions();
    expect(sessions["s1"]).toBeDefined();
    expect(sessions["s1"].channel).toBe("cli");
    expect(sessions["s1"].messageCount).toBe(1);

    await store.saveMessage("s1", { role: "assistant", content: "b" });
    expect(store.listSessions()["s1"].messageCount).toBe(2);
  });

  it("should return empty array for non-existent session", async () => {
    const messages = await store.loadSession("nonexistent");
    expect(messages).toEqual([]);
  });

  it("should clear session history", async () => {
    await store.saveMessage("s1", { role: "user", content: "a" });
    await store.saveMessage("s1", { role: "assistant", content: "b" });

    await store.clearSession("s1");

    const messages = await store.loadSession("s1");
    expect(messages).toEqual([]);
    expect(store.listSessions()["s1"].messageCount).toBe(0);
  });

  it("should delete session file and metadata", async () => {
    await store.saveMessage("s1", { role: "user", content: "a" });
    await store.deleteSession("s1");

    const messages = await store.loadSession("s1");
    expect(messages).toEqual([]);
    expect(store.listSessions()["s1"]).toBeUndefined();
  });

  it("should handle concurrent writes without corruption", async () => {
    const key = "concurrent";
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      content: `msg-${i}`,
    }));

    // Fire all writes concurrently
    await Promise.all(
      messages.map((msg) => store.saveMessage(key, msg))
    );

    const loaded = await store.loadSession(key);
    expect(loaded).toHaveLength(50);

    // All messages should be present (order may vary due to concurrency)
    const contents = new Set(loaded.map((m) => m.content));
    for (let i = 0; i < 50; i++) {
      expect(contents.has(`msg-${i}`)).toBe(true);
    }
  });
});

describe("SessionManager with store", () => {
  it("should hydrate session from disk on getOrCreate", async () => {
    await store.saveMessage("s1", { role: "user", content: "hello" }, "cli");
    await store.saveMessage("s1", { role: "assistant", content: "hi" });

    const manager = new SessionManager(store);
    const session = await manager.getOrCreate("s1", "cli");

    expect(session.history).toHaveLength(2);
    expect(session.history[0].content).toBe("hello");
    expect(session.history[1].content).toBe("hi");
  });

  it("should persist messages via persist()", async () => {
    const manager = new SessionManager(store);
    await manager.getOrCreate("s1");

    await manager.persist("s1", { role: "user", content: "test" }, "cli");

    const loaded = await store.loadSession("s1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe("test");
  });

  it("should clear session on disk via clear()", async () => {
    const manager = new SessionManager(store);
    await manager.getOrCreate("s1");
    await manager.persist("s1", { role: "user", content: "a" });

    await manager.clear("s1");

    const loaded = await store.loadSession("s1");
    expect(loaded).toEqual([]);
  });

  it("should delete session from disk via delete()", async () => {
    const manager = new SessionManager(store);
    await manager.getOrCreate("s1");
    await manager.persist("s1", { role: "user", content: "a" });

    await manager.delete("s1");

    expect(store.listSessions()["s1"]).toBeUndefined();
  });

  it("should work without a store (in-memory only)", async () => {
    const manager = new SessionManager();
    const session = await manager.getOrCreate("s1");

    session.history.push({ role: "user", content: "test" });
    await manager.persist("s1", { role: "user", content: "test" }); // no-op

    expect(session.history).toHaveLength(1);
  });
});
