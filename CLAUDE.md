# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository contains:
1. **OpenClaw Dev Guide** (`OpenClaw-Dev-Guide/`) -- internal developer documentation (Chinese) for the OpenClaw personal AI assistant system
2. **mini-claw** (`src/`, `extensions/`) -- a working implementation of the OpenClaw architecture, simplified for learning and development

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # TypeScript build
pnpm test             # Run all tests (vitest)
pnpm dev              # Start interactive CLI chat (requires ANTHROPIC_API_KEY or OPENAI_API_KEY)
pnpm gateway          # Start WebSocket gateway server + CLI channel
```

## Architecture

mini-claw follows the OpenClaw layered architecture:

```
CLI / WebSocket Clients
    │
    ▼
Gateway (src/gateway/) — WebSocket server, protocol, router, broadcaster
    │
    ├── Channel Layer (src/channels/) — CLI channel, Telegram stub
    ├── Agent Runtime (src/agent/) — model router, tool registry, execution loop
    ├── Session Manager (src/sessions/) — in-memory session storage
    └── Plugin System (src/plugins/) — loader, registry, PluginAPI
```

## Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Protocol | `src/gateway/protocol/` | TypeBox schemas for WS frames (req/res/event) |
| Gateway Server | `src/gateway/server.ts` | WebSocket server on port 18789 |
| Router | `src/gateway/router.ts` | Method handler registry |
| Model Router | `src/agent/model-router.ts` | Unified interface for Claude and OpenAI APIs |
| Agent Runtime | `src/agent/runtime.ts` | Tool execution loop: model → tool_use → execute → repeat |
| Tool Registry | `src/agent/tool-registry.ts` | Register/lookup/execute tools |
| CLI | `src/cli/program.ts` | Commander.js CLI (gateway, chat, plugins commands) |

## Tech Stack

- TypeScript (ESM), Node.js >=22, pnpm
- `ws` for WebSocket, `@sinclair/typebox` for schemas
- `@anthropic-ai/sdk` + `openai` for AI models
- `commander` for CLI, `vitest` for testing

## Environment Variables

- `ANTHROPIC_API_KEY` — Claude API key
- `OPENAI_API_KEY` — OpenAI API key

## Adding a New Tool

Create a file in `src/agent/tools/`, implement the `AgentTool` interface, and register it in `src/agent/tools/index.ts`.

## Adding a New Channel

Implement the `ChannelPlugin` interface from `src/channels/types.ts` and register it via `ChannelManager.register()`.
