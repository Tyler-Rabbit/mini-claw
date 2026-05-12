# Context Pruning Design

**Date**: 2026-05-12
**Status**: Approved

## Problem

mini-claw sends every message ever created in a session to the LLM on every call. Long sessions accumulate large tool outputs, increasing API cost and risking context window overflow. There is zero context pruning anywhere in the pipeline.

## Solution

Implement cache-TTL-based context pruning, inspired by OpenClaw's approach. Before each LLM call, prune old tool results from the in-memory message array. Full history is always preserved on disk.

## Configuration

```typescript
interface ContextPrunerConfig {
  mode: "cache-ttl" | "off";    // default: "cache-ttl"
  ttl: number;                   // ms, default: 5 * 60 * 1000 (5 minutes)
  softTrimThreshold: number;     // chars, default: 2000
  softTrimHead: number;          // chars to keep from start, default: 500
  softTrimTail: number;          // chars to keep from end, default: 500
  hardPrunePlaceholder: string;  // default: "[tool result pruned - old output]"
}
```

Config lives in agent runtime options, passed through from callers (CLI chat, gateway).

## Algorithm

**State**: `Map<string, { lastPruneTime: number; lastMessageCount: number }>` per session key.

**On each `AgentRuntime.run()` call, before `modelRouter.chat()`:**

1. **Check TTL**: If `now - lastPruneTime < ttl`, skip pruning entirely.
2. **Identify old tool results**: Walk the messages array. Any `role: "tool"` message at index < `lastMessageCount` is a candidate (i.e., it existed before the last prune).
3. **Soft trim large results**: If `content.length > softTrimThreshold`, replace with:
   ```
   {first softTrimHead chars}...{pruned N chars total}...{last softTrimTail chars}
   ```
4. **Hard prune smaller results**: Replace with `hardPrunePlaceholder`.
5. **Update state**: Set `lastPruneTime = now`, `lastMessageCount = messages.length`.

**Untouched**: `user` messages, `assistant` messages (including `tool_calls` metadata), and the current round's tool results.

**Key invariant**: `session.history` on disk is never modified. Pruning only affects the in-memory `messages` copy sent to the LLM.

## Integration

Single integration point in `AgentRuntime.run()`:

```typescript
// After building messages array, before tool loop:
const pruned = this.contextPruner.prune(session.key, messages);
messages.length = 0;
messages.push(...pruned);
```

## File Changes

| File | Change |
|------|--------|
| `src/agent/context-pruner.ts` | **New** — standalone pruner module (~80 lines) |
| `src/agent/types.ts` | Add `ContextPrunerConfig` type |
| `src/agent/runtime.ts` | Add pruner call before tool loop |

## Testing

- Unit tests for `ContextPruner.prune()` covering:
  - No pruning when TTL not expired
  - Soft trim of large old tool results
  - Hard prune of small old tool results
  - Current round messages left untouched
  - User/assistant messages never pruned
  - Mode "off" disables pruning entirely
