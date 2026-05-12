# Stop Response Feature — Design Spec

## Overview

Add the ability to abort a streaming response mid-generation, both in the TUI (CLI) and the web UI. Currently no abort mechanism exists anywhere in the stack — once a response starts streaming, the user must wait for it to complete.

## Requirements

- **TUI**: Ctrl+C during streaming aborts the response. When idle, Ctrl+C still exits the app.
- **UI**: A Stop button appears during streaming, replacing the Send button. Clicking it aborts the response.
- **Partial text**: When aborted, the partially-streamed text stays in the chat as a normal assistant message (truncated but visible).
- **Tool abort**: Abort is immediate — even if a tool is currently executing, it gets interrupted.
- **Gateway**: New `agent:abort` WebSocket method for the UI to signal abort to the server.

## Architecture

Thread a standard `AbortSignal` through the entire stack:

```
TUI: Ctrl+C → AbortController.abort()
UI:  Stop btn → GatewayClient.sendAbort() → agent:abort req → AbortController.abort()
         ↓
AgentRuntime.run(signal)
         ↓
  ┌──────┴──────┐
  │ while loop  │ ← check signal.aborted at top of each iteration
  │  model.chat │ ← pass signal to SDK (Anthropic/OpenAI native support)
  │  tool.exec  │ ← check signal before/during execution
  └─────────────┘
         ↓
  emit done { interrupted: true } → finalize partial text
```

## Changes by Layer

### 1. Agent Types (`src/agent/types.ts`)

- Add `signal?: AbortSignal` to `AgentRunOptions`
- Add `signal?: AbortSignal` to `ModelChatParams` (the params passed to `ModelProvider.chat()`)

### 2. Agent Runtime (`src/agent/runtime.ts`)

- `run()` receives `options.signal` and stores it
- At the top of each while-loop iteration: if `signal?.aborted`, emit `done` with `{ interrupted: true }` and return
- Pass `signal` to `this.modelRouter.chat()` on every call
- Before executing each tool: check `signal?.aborted`, skip remaining tools if true
- Wrap `this.toolRegistry.execute()` — if the signal fires mid-execution, the tool should throw (the SDK's fetch abort handles this for network-bound tools)

### 3. Model Providers

**Claude provider** (`src/plugins/builtins/claude-provider/provider.ts`):
- Accept `signal` from `ModelChatParams`
- Pass to `this.client.messages.stream({ ...params, signal })` — Anthropic SDK supports AbortSignal natively

**OpenAI provider** (`src/plugins/builtins/openai-provider/provider.ts`):
- Accept `signal` from `ModelChatParams`
- Pass to `this.client.chat.completions.create({ ...params, signal })` — OpenAI SDK supports AbortSignal natively

### 4. TUI (`src/cli/tui-chat.ts`)

- Create `const ac = new AbortController()` before each `agent.run()` call
- Pass `signal: ac.signal` in the run options
- Change Ctrl+C handler: when `isBusy`, call `ac.abort()` and return `{ consume: true }` (instead of ignoring)
- The stream callback's `done` event handler already finalizes the message — no change needed there
- On next user input after abort, create a fresh AbortController

### 5. Gateway Protocol

**Schema** (`src/gateway/protocol/schema.ts`):
- Add `AbortParams` schema: `{ runId: string }`

**Types** (`src/gateway/protocol/types.ts`):
- Add `AbortParams` type

**Gateway handler** (`src/cli/commands/gateway.ts`):
- Maintain `activeRuns: Map<string, AbortController>` per gateway instance
- On `agent` request: create AbortController, store in map keyed by `runId`, pass `signal` to `agent.run()`
- Register `agent:abort` handler: look up controller by `runId`, call `.abort()`, remove from map
- On normal completion: remove from map
- Send `agent:stream { runId, text: "", done: true, interrupted: true }` on abort

### 6. Web UI

**GatewayClient** (`ui/src/gateway/client.ts`):
- Add `sendAbort(runId: string)` method that calls `this.request('agent:abort', { runId })`

**useGateway hook** (`ui/src/hooks/useGateway.ts`):
- Expose `abort()` function that calls `gateway.sendAbort(currentRunId)`
- Track `currentRunId` from the `agent` request response
- Handle `interrupted` flag in `agent:stream` done event (same as normal done, partial text stays)

**ChatInput** (`ui/src/components/ChatInput.tsx`):
- Accept `onStop` prop and `isStreaming` prop
- When `isStreaming`: show a Stop button (square icon) instead of Send button
- Clicking Stop calls `onStop()`

**App** (`ui/src/App.tsx`):
- Pass `abort` from `useGateway` to `ChatInput` as `onStop`
- Pass `isStreaming` to `ChatInput`

**CSS** (`ui/src/index.css`):
- Add `.stop-btn` style (red/dark background, square icon)

## Event Flow

### Normal completion
```
Client → agent req
Server → res { status: "accepted" }
Server → event agent:stream { text: "Hello", done: false }  (repeated)
Server → event agent:stream { text: "", done: true }
```

### Abort during text streaming
```
Client → agent req
Server → res { status: "accepted" }
Server → event agent:stream { text: "Hello", done: false }
Client → agent:abort req { runId }
Server → res { ok: true }  (abort acknowledged)
Server → event agent:stream { text: "", done: true, interrupted: true }
```

### Abort during tool execution
```
Client → agent req
Server → res { status: "accepted" }
Server → event agent:stream { text: "Let me search...", done: false }
Server → event agent:tool_use { toolName: "search", ... }
Client → agent:abort req { runId }
Server → res { ok: true }
Server → event agent:stream { text: "", done: true, interrupted: true }
```

## Files to Modify

| File | Change |
|------|--------|
| `src/agent/types.ts` | Add `signal` to `AgentRunOptions` and `ModelChatParams` |
| `src/agent/runtime.ts` | Check signal in loop, pass to model calls and tool execution |
| `src/plugins/builtins/claude-provider/provider.ts` | Pass signal to Anthropic SDK |
| `src/plugins/builtins/openai-provider/provider.ts` | Pass signal to OpenAI SDK |
| `src/cli/tui-chat.ts` | AbortController, Ctrl+C triggers abort |
| `src/gateway/protocol/schema.ts` | Add `AbortParams` schema |
| `src/gateway/protocol/types.ts` | Add `AbortParams` type |
| `src/cli/commands/gateway.ts` | Track active runs, handle `agent:abort` |
| `ui/src/gateway/client.ts` | Add `sendAbort()` method |
| `ui/src/hooks/useGateway.ts` | Expose `abort()`, track `runId` |
| `ui/src/components/ChatInput.tsx` | Stop button when streaming |
| `ui/src/App.tsx` | Wire abort to ChatInput |
| `ui/src/index.css` | Stop button styling |
