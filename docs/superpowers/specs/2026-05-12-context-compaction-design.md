# Context Compaction Design

**Date:** 2026-05-12
**Status:** Approved

## Problem

mini-claw's `ContextPruner` handles TTL-based tool result pruning, but lacks **compaction** — the ability to summarize old conversation history using the model. Long conversations hit context limits and either fail or lose information through truncation.

## Solution

Add a `CompactionModule` that detects when the conversation approaches context limits and uses the same model to generate a rolling summary of older messages, preserving key information while reducing token count.

## Requirements

1. **Auto-compaction**: Trigger when either message count OR token count exceeds a threshold
2. **Manual compaction**: `/compact` command in TUI chat, with optional instruction
3. **Rolling summary**: On re-compaction, summarize the previous summary + new messages
4. **System message preservation**: System messages are excluded from summarization
5. **Same model**: Use the current chat model for summarization (no extra provider)

## Architecture

### New Module: `src/agent/compaction.ts`

```
CompactionModule
├── needsCompaction(sessionKey, usage) → boolean
├── compact(sessionKey, messages, modelRouter, instruction?) → ModelMessage[]
└── resetSession(sessionKey) → void
```

**State tracking** (per session):
- `messageCount`: total messages since last compaction
- `inputTokens`: cumulative input tokens from model responses
- `compactedUpTo`: index marking where summarized messages end

### Integration Point

In `AgentRuntime.run()`, after each model response and usage accumulation:

```
response = await modelRouter.chat(...)
addUsage(response.usage)

if (compaction.needsCompaction(sessionKey, totalUsage)) {
  const compacted = await compaction.compact(sessionKey, messages, modelRouter)
  messages.length = 0
  messages.push(...compacted)
  session.history = compacted
}
```

### Configuration

```typescript
interface CompactionConfig {
  enabled: boolean;
  maxMessages: number;        // default 50
  maxInputTokens: number;     // default 100,000
  keepRecentMessages: number; // default 5
  summaryPrompt: string;      // customizable summarization instruction
}
```

Added to `MiniClawConfig.agent.compaction`.

### Manual `/compact` Command

In TUI chat input handler:
- `/compact` — trigger compaction with default prompt
- `/compact Focus on API decisions` — trigger with custom instruction
- Calls `compaction.compact()` directly, bypasses threshold checks

## Summarization Prompt

Default prompt (configurable):

```
You are a conversation summarizer. Produce a concise summary of the conversation below.
Preserve:
- Key decisions and their reasoning
- User preferences and constraints
- Important tool results (data, errors, configurations)
- Open questions or unfinished tasks

Omit:
- Routine tool calls with no lasting significance
- Repeated or redundant information
- Boilerplate and formatting

The summary will be used as context for continuing the conversation.
```

When a previous summary exists, prepend: "Previous summary:\n{previous}\n\nNew messages to incorporate:\n{messages}"

## Rolling Summary Flow

1. First compaction: summarize messages[0..N] → summaryA
2. Second compaction: summarize summaryA + messages[N+1..M] → summaryB
3. Third compaction: summarize summaryB + messages[M+1..P] → summaryC

The summary message is stored as a `ModelMessage` with `role: "system"` and a `[Compacted Summary]` prefix.

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/agent/compaction.ts` | Create | CompactionModule class |
| `src/agent/types.ts` | Modify | Add CompactionConfig interface and defaults |
| `src/agent/runtime.ts` | Modify | Integrate compaction check in run loop |
| `src/config/config.ts` | Modify | Add compaction config to MiniClawConfig |
| `src/cli/tui-chat.ts` | Modify | Add /compact command handler |
| `test/compaction.test.ts` | Create | Unit + integration tests |

## Testing

**Unit tests** (`test/compaction.test.ts`):
- Threshold detection: message count, token count, both, disabled
- Rolling summary: previous summary + new messages → updated summary
- System message preservation: system messages excluded from summarization
- `keepRecentMessages`: recent N messages always preserved
- Reset session state

**Integration tests**:
- Full compaction cycle with mock model provider
- `/compact` manual trigger via TUI
- Session persistence: compacted summary survives reload
