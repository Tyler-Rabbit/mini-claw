# Stop Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to abort a streaming response mid-generation in both the TUI (Ctrl+C) and web UI (Stop button).

**Architecture:** Thread a standard `AbortSignal` through the entire stack — from TUI/UI through AgentRuntime to ModelProviders. The gateway gains a new `agent:abort` WebSocket method. Partial text stays in chat on abort.

**Tech Stack:** TypeScript, AbortController/AbortSignal (Node.js built-in), Anthropic SDK (native signal support), OpenAI SDK (native signal support), React 19, WebSocket

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/agent/types.ts` | Modify | Add `signal` to `AgentRunOptions` and `ModelProvider.chat` params |
| `src/agent/model-router.ts` | Modify | Pass `signal` through to provider |
| `src/agent/runtime.ts` | Modify | Check signal in loop, pass to model/tool calls |
| `src/plugins/builtins/claude-provider/provider.ts` | Modify | Pass signal to Anthropic SDK stream |
| `src/plugins/builtins/openai-provider/provider.ts` | Modify | Pass signal to OpenAI SDK stream |
| `src/gateway/protocol/schema.ts` | Modify | Add `AbortParamsSchema` |
| `src/gateway/protocol/types.ts` | Modify | Add `AbortParams` type |
| `src/cli/commands/gateway.ts` | Modify | Track active runs, handle `agent:abort` |
| `src/cli/tui-chat.ts` | Modify | AbortController, Ctrl+C triggers abort |
| `test/agent-runtime.test.ts` | Modify | Add abort tests |
| `ui/src/gateway/client.ts` | Modify | Add `sendAbort()` method |
| `ui/src/hooks/useGateway.ts` | Modify | Expose `abort()`, track `runId` |
| `ui/src/components/ChatInput.tsx` | Modify | Stop button when streaming |
| `ui/src/App.tsx` | Modify | Wire abort to ChatInput |
| `ui/src/index.css` | Modify | Stop button styling |

---

### Task 1: Add `signal` to agent types

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: Add `signal` to `AgentRunOptions`**

In `src/agent/types.ts`, add `signal?: AbortSignal` to the `AgentRunOptions` interface (line 38):

```typescript
export interface AgentRunOptions {
  message: string;
  sessionKey: string;
  channel?: string;
  senderId?: string;
  model?: string;
  history?: ModelMessage[];
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Add `signal` to `ModelProvider.chat` params**

In the same file, add `signal?: AbortSignal` to the `ModelProvider.chat` params (line 62):

```typescript
export interface ModelProvider {
  name: string;
  chat(params: {
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    model?: string;
    stream?: boolean;
    onChunk?: (text: string) => void;
    system?: string;
    signal?: AbortSignal;
  }): Promise<ModelResponse>;
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/agent/types.ts
git commit -m "feat(agent): add AbortSignal to types"
```

---

### Task 2: Pass signal through ModelRouter

**Files:**
- Modify: `src/agent/model-router.ts`

- [ ] **Step 1: Add `signal` to `ModelRouter.chat` params and pass through**

In `src/agent/model-router.ts`, update the `chat` method (line 38) to accept and forward `signal`:

```typescript
async chat(params: {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  model?: string;
  provider?: string;
  stream?: boolean;
  onChunk?: (text: string) => void;
  system?: string;
  signal?: AbortSignal;
}): Promise<ModelResponse> {
  const provider = this.getProvider(params.provider);
  return provider.chat(params);
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agent/model-router.ts
git commit -m "feat(agent): pass signal through ModelRouter"
```

---

### Task 3: Pass signal to Anthropic SDK

**Files:**
- Modify: `src/plugins/builtins/claude-provider/provider.ts`

- [ ] **Step 1: Accept and forward `signal` in streaming path**

In `src/plugins/builtins/claude-provider/provider.ts`, update the `chat` method signature to include `signal?: AbortSignal` in the params type (line 21), then pass it to the stream call.

Change the params type (line 21-28):
```typescript
async chat(params: {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  model?: string;
  stream?: boolean;
  onChunk?: (text: string) => void;
  system?: string;
  signal?: AbortSignal;
}): Promise<ModelResponse> {
```

Change the stream call (line 75) to pass signal:
```typescript
const stream = this.client.messages.stream({
  model,
  max_tokens: 4096,
  ...(system ? { system } : {}),
  messages: claudeMessages,
  ...(claudeTools ? { tools: claudeTools } : {}),
}, { signal: params.signal });
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/plugins/builtins/claude-provider/provider.ts
git commit -m "feat(claude): pass AbortSignal to SDK stream"
```

---

### Task 4: Pass signal to OpenAI SDK

**Files:**
- Modify: `src/plugins/builtins/openai-provider/provider.ts`

- [ ] **Step 1: Accept and forward `signal` in streaming path**

In `src/plugins/builtins/openai-provider/provider.ts`, update the `chat` method signature to include `signal?: AbortSignal` in the params type (line 21), then pass it to the create call.

Change the params type (line 21-28):
```typescript
async chat(params: {
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  model?: string;
  stream?: boolean;
  onChunk?: (text: string) => void;
  system?: string;
  signal?: AbortSignal;
}): Promise<ModelResponse> {
```

Change the streaming create call (line 72) to pass signal:
```typescript
const stream = await this.client.chat.completions.create({
  model,
  messages: oaiMessages,
  ...(oaiTools ? { tools: oaiTools } : {}),
  stream: true,
}, { signal: params.signal });
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/plugins/builtins/openai-provider/provider.ts
git commit -m "feat(openai): pass AbortSignal to SDK stream"
```

---

### Task 5: Add abort checks to AgentRuntime

**Files:**
- Modify: `src/agent/runtime.ts`
- Modify: `test/agent-runtime.test.ts`

- [ ] **Step 1: Write test for abort during model call**

Add to `test/agent-runtime.test.ts`:

```typescript
describe("AgentRuntime abort", () => {
  it("should emit done with interrupted when signal is aborted before run", async () => {
    const mockProvider = new MockProvider();
    mockProvider.setResponses([
      { content: "Should not reach here", toolCalls: [], stopReason: "end_turn" },
    ]);

    const router = new ModelRouter();
    router.registerProvider(mockProvider);

    const agent = new AgentRuntime({
      modelRouter: router,
      toolRegistry: new ToolRegistry(),
      sessionManager: new SessionManager(),
      defaultProvider: "mock",
    });

    const ac = new AbortController();
    ac.abort(); // abort before calling run

    const events: AgentStreamEvent[] = [];
    await agent.run(
      { message: "Hi", sessionKey: "test-abort-1", signal: ac.signal },
      (e) => events.push(e)
    );

    expect(events.some((e) => e.type === "done")).toBe(true);
    // Should not have produced any text
    expect(events.some((e) => e.type === "text")).toBe(false);
  });

  it("should emit done with interrupted when signal aborts mid-stream", async () => {
    const mockProvider = new MockProvider();
    // Provider that checks signal during chunk emission
    const slowProvider: ModelProvider = {
      name: "slow",
      async chat(params) {
        if (params.onChunk) {
          params.onChunk("Hello ");
          // Simulate abort after first chunk
          if (params.signal?.aborted) {
            return { content: "Hello ", toolCalls: [], stopReason: "end_turn" };
          }
          params.onChunk("world");
        }
        return { content: "Hello world", toolCalls: [], stopReason: "end_turn" };
      },
    };

    const router = new ModelRouter();
    router.registerProvider(slowProvider);

    const agent = new AgentRuntime({
      modelRouter: router,
      toolRegistry: new ToolRegistry(),
      sessionManager: new SessionManager(),
      defaultProvider: "slow",
    });

    const ac = new AbortController();
    let chunkCount = 0;
    const events: AgentStreamEvent[] = [];

    await agent.run(
      { message: "Hi", sessionKey: "test-abort-2", signal: ac.signal },
      (e) => {
        events.push(e);
        if (e.type === "text") {
          chunkCount++;
          if (chunkCount === 1) ac.abort(); // abort after first chunk
        }
      }
    );

    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — abort tests fail because `runtime.ts` doesn't check signal yet

- [ ] **Step 3: Implement abort checks in `AgentRuntime.run()`**

In `src/agent/runtime.ts`:

1. Extract `signal` from options (after line 59):
```typescript
const { message, sessionKey, channel = "cli", senderId = "local", model, history, signal } = options;
```

2. Add abort check at the top of the while loop (before line 92, inside the while):
```typescript
while (round < this.maxToolRounds) {
  round++;

  // Check if aborted before starting a new round
  if (signal?.aborted) {
    onEvent?.({
      type: "done",
      usage: totalUsage,
      durationMs: Date.now() - startTime,
    });
    return "";
  }
```

3. Pass `signal` to `this.modelRouter.chat()` — add `signal` to both chat calls (line 94 and line 183):
```typescript
const response = await this.modelRouter.chat({
  messages,
  tools: tools.length > 0 ? tools : undefined,
  model: model || this.defaultModel || undefined,
  provider: this.defaultProvider,
  stream: true,
  onChunk: (text) => {
    onEvent?.({ type: "text", content: text });
  },
  system: resolvedSystemPrompt || undefined,
  signal,
});
```

4. Add abort check before tool execution (before line 141):
```typescript
// Execute each tool and add results
for (const toolCall of response.toolCalls) {
  // Check abort before each tool
  if (signal?.aborted) {
    onEvent?.({
      type: "done",
      usage: totalUsage,
      durationMs: Date.now() - startTime,
    });
    return "";
  }

  onEvent?.({
    type: "tool_use",
```

5. Also add `signal` to the final model call (line 183-193):
```typescript
const finalResponse = await this.modelRouter.chat({
  messages: finalMessages,
  model: model || this.defaultModel || undefined,
  provider: this.defaultProvider,
  stream: true,
  onChunk: (text) => {
    onEvent?.({ type: "text", content: text });
  },
  system: resolvedSystemPrompt || undefined,
  signal,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/agent/runtime.ts test/agent-runtime.test.ts
git commit -m "feat(agent): add abort signal checks to runtime"
```

---

### Task 6: Add `AbortParams` to gateway protocol

**Files:**
- Modify: `src/gateway/protocol/schema.ts`
- Modify: `src/gateway/protocol/types.ts`

- [ ] **Step 1: Add `AbortParamsSchema` to schema**

In `src/gateway/protocol/schema.ts`, add after `AgentParamsSchema` (after line 23):

```typescript
export const AbortParamsSchema = Type.Object({
  runId: Type.String(),
});
```

- [ ] **Step 2: Add `AbortParams` type**

In `src/gateway/protocol/types.ts`, add after the `AgentParams` line:

```typescript
import type {
  ConnectParamsSchema,
  AgentParamsSchema,
  AbortParamsSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  FrameSchema,
} from "./schema.js";

export type ConnectParams = Static<typeof ConnectParamsSchema>;
export type AgentParams = Static<typeof AgentParamsSchema>;
export type AbortParams = Static<typeof AbortParamsSchema>;
// ... rest unchanged
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/gateway/protocol/schema.ts src/gateway/protocol/types.ts
git commit -m "feat(protocol): add AbortParams schema and type"
```

---

### Task 7: Handle `agent:abort` in gateway

**Files:**
- Modify: `src/cli/commands/gateway.ts`

- [ ] **Step 1: Add active runs tracking and abort handler**

In `src/cli/commands/gateway.ts`:

1. Add import for `AbortParams`:
```typescript
import type { AgentParams, AbortParams } from "../../gateway/protocol/types.js";
```

2. Create a `Map` to track active runs before registering the agent handler (before line 66):
```typescript
const activeRuns = new Map<string, AbortController>();
```

3. In the `"agent"` handler, create an AbortController and store it (after line 66):
```typescript
gateway.getRouter().register("agent", async (ctx) => {
  const params = ctx.params as AgentParams & { id: string };
  const requestId = params.id;

  const ac = new AbortController();
  activeRuns.set(requestId, ac);

  try {
    // ... existing code, but pass signal to agent.run:
    await agent.run(
      {
        message: params.message,
        sessionKey: params.sessionKey,
        model: params.model,
        signal: ac.signal,
      },
      // ... rest of handler unchanged
    );
  } catch (err) {
    // ... existing error handling
  } finally {
    activeRuns.delete(requestId);
  }
});
```

4. Register the `agent:abort` handler after the agent handler:
```typescript
gateway.getRouter().register("agent:abort", async (ctx) => {
  const params = ctx.params as AbortParams & { id: string };
  const { runId } = params;

  const ac = activeRuns.get(runId);
  if (ac) {
    ac.abort();
    activeRuns.delete(runId);
    ctx.send({
      type: "res",
      id: params.id,
      ok: true,
      payload: { status: "aborted" },
    });
  } else {
    ctx.send({
      type: "res",
      id: params.id,
      ok: false,
      error: { message: `No active run found: ${runId}` },
    });
  }
});
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/gateway.ts
git commit -m "feat(gateway): handle agent:abort request"
```

---

### Task 8: Add Ctrl+C abort to TUI

**Files:**
- Modify: `src/cli/tui-chat.ts`

- [ ] **Step 1: Create AbortController before agent.run and wire Ctrl+C**

In `src/cli/tui-chat.ts`:

1. Add a mutable `AbortController` variable in the state section (after line 96):
```typescript
let abortController: AbortController | null = null;
```

2. In `processMessage()`, create a new AbortController before calling `agent.run()` (before line 170):
```typescript
abortController = new AbortController();
try {
  await agent.run(
    { message: text, sessionKey, channel: "cli", senderId: "local", signal: abortController.signal },
    // ... existing callback unchanged
  );
} catch (err) {
  // ... existing error handling
} finally {
  abortController = null;
  // ... existing cleanup
}
```

3. Change the Ctrl+C handler (line 378) to abort when busy instead of ignoring:
```typescript
tui.addInputListener((data) => {
  if (matchesKey(data, "ctrl+c")) {
    if (isBusy) {
      // Abort the current response
      abortController?.abort();
      return { consume: true };
    }
    const now = Date.now();
    // ... rest of existing double-press logic unchanged
  }
});
```

- [ ] **Step 2: Update /help text to reflect Ctrl+C behavior**

Change the help text (line 312) from:
```
"  Ctrl+C    Clear input / exit",
```
to:
```
"  Ctrl+C    Stop response / Clear input / exit",
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/cli/tui-chat.ts
git commit -m "feat(tui): Ctrl+C aborts streaming response"
```

---

### Task 9: Add `sendAbort` to UI GatewayClient

**Files:**
- Modify: `ui/src/gateway/client.ts`

- [ ] **Step 1: Add `sendAbort` method**

In `ui/src/gateway/client.ts`, add after `sendAgentMessage` (after line 124):

```typescript
sendAbort(runId: string): Promise<unknown> {
  return this.request('agent:abort', { runId })
}
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/gateway/client.ts
git commit -m "feat(ui/client): add sendAbort method"
```

---

### Task 10: Add `abort()` to useGateway hook

**Files:**
- Modify: `ui/src/hooks/useGateway.ts`

- [ ] **Step 1: Track current runId and expose abort**

In `ui/src/hooks/useGateway.ts`:

1. Add a ref to track the current run ID (after line 19):
```typescript
const currentRunIdRef = useRef<string | null>(null)
```

2. In the `agent:stream` done handler, capture the runId from the payload:
```typescript
client.on('agent:stream', (payload) => {
  const { text, done, runId } = payload as StreamChunk & { runId?: string }
  if (done) {
    setIsStreaming(false)
    setStreamingText(streamBufferRef.current)
    currentRunIdRef.current = null
  } else {
    if (runId) currentRunIdRef.current = runId
    streamBufferRef.current += text
    setStreamingText(streamBufferRef.current)
  }
})
```

Also update the `StreamChunk` interface:
```typescript
export interface StreamChunk {
  runId: string
  text: string
  done: boolean
}
```

3. In `sendMessage`, capture the runId from the request response:
```typescript
const sendMessage = useCallback(async (message: string) => {
  const client = clientRef.current
  if (!client?.connected) return
  streamBufferRef.current = ''
  toolCallsRef.current = []
  setStreamingText('')
  setStreamingToolCalls([])
  setIsStreaming(true)
  try {
    const res = await client.sendAgentMessage(message) as { runId?: string } | undefined
    // The server ack doesn't include runId, but we track it via events
  } catch (e) {
    setIsStreaming(false)
    setStreamingText(`Error: ${(e as Error).message}`)
  }
}, [])
```

4. Add `abort` function (after `sendMessage`):
```typescript
const abort = useCallback(async () => {
  const client = clientRef.current
  if (!client?.connected) return
  // Send abort with the agent request's runId (which is the request id)
  // We need to track the request id from sendAgentMessage
  // Since the gateway uses the request id as runId, we track it
  if (currentRunIdRef.current) {
    try {
      await client.sendAbort(currentRunIdRef.current)
    } catch {
      // Ignore — run may have already finished
    }
  }
  setIsStreaming(false)
}, [])
```

5. Return `abort` from the hook (line 105):
```typescript
return {
  connected, connecting, connect, disconnect, sendMessage, abort,
  streamingText, isStreaming, streamingToolCalls,
}
```

- [ ] **Step 2: Track request ID as runId**

The gateway uses the request frame's `id` as the `runId` in events. We need to capture this. Update `sendAgentMessage` in the client to return the request ID, or track it in the hook.

Simpler approach: modify `GatewayClient.sendAgentMessage` to also store the last request id:

In `ui/src/gateway/client.ts`, add a public getter:
```typescript
private _lastAgentRequestId: string | null = null
get lastAgentRequestId() { return this._lastAgentRequestId }

sendAgentMessage(message: string, sessionKey = 'default'): Promise<unknown> {
  // The request id is generated inside request(), so we need to capture it
  // Refactor: make request return the id
  return this.request('agent', { message, sessionKey })
}
```

Actually, simpler: refactor `request` to also store the last request id. Or better: have `sendAgentMessage` return both the promise and the id.

Cleanest approach — modify `request` to expose the id:

In `ui/src/gateway/client.ts`:
```typescript
request(method: string, params: unknown): { promise: Promise<unknown>; id: string } {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    return { promise: Promise.reject(new Error('Not connected')), id: '' }
  }
  const id = String(this.nextId++)
  const p = new Promise<unknown>((resolve, reject) => {
    this.pending.set(id, { resolve, reject })
  })
  const frame: RequestFrame = { type: 'req', id, method, params }
  this.ws.send(JSON.stringify(frame))
  return { promise: p, id }
}
```

But this changes the existing API. To avoid breaking changes, add a separate method:

```typescript
sendAgentMessageWithId(message: string, sessionKey = 'default'): { promise: Promise<unknown>; id: string } {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    return { promise: Promise.reject(new Error('Not connected')), id: '' }
  }
  const id = String(this.nextId++)
  const p = new Promise<unknown>((resolve, reject) => {
    this.pending.set(id, { resolve, reject })
  })
  const frame: RequestFrame = { type: 'req', id, method: 'agent', params: { message, sessionKey } }
  this.ws.send(JSON.stringify(frame))
  return { promise: p, id }
}
```

Then in `useGateway.ts`:
```typescript
const sendMessage = useCallback(async (message: string) => {
  const client = clientRef.current
  if (!client?.connected) return
  streamBufferRef.current = ''
  toolCallsRef.current = []
  setStreamingText('')
  setStreamingToolCalls([])
  setIsStreaming(true)
  try {
    const { promise, id } = client.sendAgentMessageWithId(message)
    currentRunIdRef.current = id
    await promise
  } catch (e) {
    setIsStreaming(false)
    setStreamingText(`Error: ${(e as Error).message}`)
  }
}, [])
```

- [ ] **Step 3: Verify types compile**

Run: `cd ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add ui/src/gateway/client.ts ui/src/hooks/useGateway.ts
git commit -m "feat(ui/hook): add abort function and track runId"
```

---

### Task 11: Add Stop button to ChatInput

**Files:**
- Modify: `ui/src/components/ChatInput.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/index.css`

- [ ] **Step 1: Update ChatInput to accept `onStop` and `isStreaming`**

In `ui/src/components/ChatInput.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react'

interface Props {
  onSend: (message: string) => void
  onStop: () => void
  disabled: boolean
  isStreaming: boolean
}

export function ChatInput({ onSend, onStop, disabled, isStreaming }: Props) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  const handleSend = () => {
    const text = input.trim()
    if (!text || disabled) return
    onSend(text)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-input">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? 'Waiting for response...' : 'Type a message...'}
        disabled={disabled}
        rows={1}
      />
      {isStreaming ? (
        <button className="stop-btn" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button onClick={handleSend} disabled={disabled || !input.trim()}>
          Send
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire abort in App.tsx**

In `ui/src/App.tsx`:

1. Destructure `abort` from `useGateway` (line 11):
```typescript
const {
  connected, connecting, connect, disconnect, sendMessage, abort,
  streamingText, isStreaming, streamingToolCalls,
} = useGateway(WS_URL)
```

2. Update `ChatInput` usage (line 106):
```typescript
<ChatInput onSend={handleSend} onStop={abort} disabled={!connected || isStreaming} isStreaming={isStreaming} />
```

- [ ] **Step 3: Add stop button CSS**

In `ui/src/index.css`, add after the existing `.chat-input button:disabled` rule (after line 347):

```css
.chat-input .stop-btn {
  background: var(--red);
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.chat-input .stop-btn:hover {
  background: #dc2626;
}
```

- [ ] **Step 4: Verify UI builds**

Run: `cd ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/ChatInput.tsx ui/src/App.tsx ui/src/index.css
git commit -m "feat(ui): add Stop button during streaming"
```

---

### Task 12: Handle interrupted flag in UI

**Files:**
- Modify: `ui/src/hooks/useGateway.ts`

- [ ] **Step 1: Handle `interrupted` in agent:stream done event**

In the `agent:stream` handler in `useGateway.ts`, the `done` event already sets `isStreaming` to false and finalizes the text. The `interrupted` flag from the server is informational — the partial text stays as-is (per spec). No code change needed for the happy path.

However, we should make sure the `abort` function also immediately sets `isStreaming` to false (so the UI responds instantly without waiting for the server event):

In the `abort` callback:
```typescript
const abort = useCallback(async () => {
  const client = clientRef.current
  if (!client?.connected) return
  // Immediately stop streaming UI
  setIsStreaming(false)
  // Send abort to server
  if (currentRunIdRef.current) {
    try {
      await client.sendAbort(currentRunIdRef.current)
    } catch {
      // Ignore — run may have already finished
    }
  }
  currentRunIdRef.current = null
}, [])
```

- [ ] **Step 2: Verify UI builds**

Run: `cd ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add ui/src/hooks/useGateway.ts
git commit -m "feat(ui): handle interrupted state on abort"
```

---

### Task 13: Build and test everything

- [ ] **Step 1: Build the backend**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass, including new abort tests

- [ ] **Step 3: Build the UI**

Run: `cd ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual smoke test (TUI)**

Run: `pnpm dev`
- Send a message, then press Ctrl+C while it's streaming
- Verify the response stops and partial text remains visible
- Send another message — verify it works normally
- Press Ctrl+C when idle — verify it still clears input / exits on double-press

- [ ] **Step 5: Manual smoke test (UI)**

Run: `pnpm gateway` in one terminal, `cd ui && npm run dev` in another
- Open the web UI, connect, send a message
- Click the Stop button while streaming
- Verify the response stops and partial text remains
- Send another message — verify it works normally

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: polish stop-response implementation"
```
