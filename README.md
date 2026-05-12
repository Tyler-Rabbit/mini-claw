# Mini-Claw

A modular, extensible personal AI assistant system built in TypeScript. Inspired by the [OpenClaw](OpenClaw-Dev-Guide/) architecture, designed for learning and rapid development.

## Features

- **Multi-model support** -- Claude (Anthropic) and OpenAI out of the box, extensible via plugins
- **Agent runtime** -- Tool-calling loop with streaming, context pruning, and automatic compaction
- **Plugin system** -- Load tools, channels, model providers, and search providers from `extensions/`
- **Skill system** -- Slash-command prompt templates with argument substitution, sub-agents, and reference docs
- **Session persistence** -- File-based JSONL storage with concurrent-write safety
- **WebSocket gateway** -- Multi-client server with typed protocol (req/res/event frames)
- **Multiple interfaces** -- Rich TUI, Web UI (React), and CLI
- **Workspace context** -- System prompt assembled from markdown files (SOUL, AGENTS, USER, MEMORY)

## Quick Start

### Prerequisites

- Node.js >= 22
- pnpm

### Install

```bash
git clone <repo-url> && cd mini-claw
pnpm install
```

### Configure

Run the interactive onboarding wizard:

```bash
pnpm dev:onboard
```

Or set environment variables directly:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # For Claude
export OPENAI_API_KEY=sk-...          # For OpenAI
```

### Run

```bash
pnpm dev          # Start TUI chat session
pnpm gateway      # Start WebSocket gateway + CLI channel
pnpm ui           # Start Web UI (React, opens in browser)
```

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Clients                                        │
│                                                                             │
│   ┌──────────┐    ┌──────────────────┐    ┌──────────────────┐              │
│   │   TUI    │    │   Web UI (React) │    │  External WS     │              │
│   │  (CLI)   │    │     (Vite)       │    │  Clients         │              │
│   └────┬─────┘    └────────┬─────────┘    └────────┬─────────┘              │
│        │                   │                       │                        │
└────────┼───────────────────┼───────────────────────┼────────────────────────┘
         │                   │                       │
         │  readline         │  HTTP/WS              │  WebSocket
         │                   │                       │
┌────────┼───────────────────┼───────────────────────┼────────────────────────┐
│        │            Gateway Layer                   │                        │
│        ▼                   ▼                       ▼                        │
│   ┌─────────────────────────────────────────────────────────────┐           │
│   │                   GatewayServer (:18789)                     │           │
│   │  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │           │
│   │  │  Router   │  │  Broadcaster │  │  Protocol (TypeBox)   │  │           │
│   │  │  method   │  │  broadcast() │  │  req / res / event    │  │           │
│   │  │  registry │  │  send()      │  │  frame schemas        │  │           │
│   │  └──────────┘  └──────────────┘  └───────────────────────┘  │           │
│   └────────────────────────┬────────────────────────────────────┘           │
│                            │                                                │
└────────────────────────────┼────────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────────────────┐
         │                   │                               │
         ▼                   ▼                               ▼
┌─────────────────┐ ┌─────────────────┐           ┌─────────────────┐
│  Channel Layer  │ │  Skills System  │           │   Workspace     │
│                 │ │                 │           │                 │
│  CliChannel     │ │  SkillRegistry  │           │  ContextBuilder │
│  TelegramChannel│ │  SkillExecutor  │           │                 │
│  QQBotChannel*  │ │  invoke_skill   │           │  SOUL.md        │
│                 │ │  tool           │           │  AGENTS.md      │
└────────┬────────┘ └────────┬────────┘           │  USER.md        │
         │                   │                    │  MEMORY.md      │
         │                   │                    │  memory/*.md    │
         │                   │                    └────────┬────────┘
         │                   │                             │
         ▼                   ▼                             │ system prompt
┌──────────────────────────────────────────────────────────┼──────────────────┐
│                        Agent Runtime                      │                  │
│                                                          │                  │
│  ┌───────────────────────────────────────────────────────┼──────────────┐   │
│  │                  AgentRuntime                          │              │   │
│  │                                                       ▼              │   │
│  │   ┌───────────┐   ┌──────────────┐   ┌──────────────────────┐       │   │
│  │   │   Model    │   │  Tool        │   │  Context Manager     │       │   │
│  │   │   Router   │   │  Registry    │   │                      │       │   │
│  │   │            │   │              │   │  ContextPruner       │       │   │
│  │   │  claude ──►│   │  echo        │   │  (TTL-based trim)    │       │   │
│  │   │  openai ──►│   │  calculator  │   │                      │       │   │
│  │   │  mimo*  ──►│   │  date_time   │   │  CompactionModule    │       │   │
│  │   │            │   │  bash        │   │  (auto-summary)      │       │   │
│  │   └─────┬──────┘   │  web_fetch   │   └──────────────────────┘       │   │
│  │         │          │  web_search  │                                  │   │
│  │         │          └──────┬───────┘                                  │   │
│  │         │                 │                                          │   │
│  │         ▼                 ▼                                          │   │
│  │   ┌─────────────────────────────┐                                    │   │
│  │   │   Execution Loop (max 20)   │                                    │   │
│  │   │                             │                                    │   │
│  │   │   model.chat()              │                                    │   │
│  │   │       │                     │                                    │   │
│  │   │       ▼                     │                                    │   │
│  │   │   tool_use? ──yes──► execute + append result                    │   │
│  │   │       │                     │                                    │   │
│  │   │      no                     │                                    │   │
│  │   │       │                     │                                    │   │
│  │   │       ▼                     │                                    │   │
│  │   │   return final text         │                                    │   │
│  │   └─────────────────────────────┘                                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────┬───────────────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Session Manager │ │ Plugin System   │ │  Model Providers │
│                 │ │                 │ │                  │
│ SessionManager  │ │ PluginRegistry  │ │  ClaudeProvider  │
│  (in-memory)    │ │ PluginLoader    │ │  OpenAIProvider  │
│                 │ │ PluginAPI       │ │  XiaomiProvider* │
│ SessionStore    │ │                 │ │                  │
│  (JSONL files)  │ │  Built-in:      │ │  SearchProviders │
│                 │ │  claude-provider│ │  DuckDuckGo*     │
│  sessions.json  │ │  openai-provider│ │                  │
│  <key>.jsonl    │ │                 │ │                  │
│                 │ │  Extensions/:   │ │                  │
│                 │ │  hello-plugin   │ │                  │
│                 │ │  duckduckgo*    │ │                  │
│                 │ │  xiaomi*        │ │                  │
│                 │ │  qqbot*         │ │                  │
└─────────────────┘ └─────────────────┘ └─────────────────┘

  * = extension plugin (loaded from extensions/)
```

### Gateway

WebSocket server (default `127.0.0.1:18789`) with a typed frame protocol:

| Frame | Direction | Purpose |
| :--- | :--- | :--- |
| `req` | Client -> Server | Request with method + params |
| `res` | Server -> Client | Response with ok/error |
| `event` | Server -> Client | Push events (streaming, notifications) |

### Agent Runtime

The core execution loop:

1. Resolve system prompt (static or dynamic per session)
2. Load session history, apply context pruning
3. Stream model response -- emit text/tool_use/tool_result events
4. If tool calls present, execute them and loop (max 20 rounds)
5. Auto-compact when message count or token thresholds are exceeded

### Plugin System

Plugins are loaded from `extensions/` directories. Each plugin has a `mini-claw.plugin.json` manifest and an `index.ts` entry point that receives a `PluginAPI`:

```typescript
export function register(api: PluginAPI) {
  api.registerTool(myTool);
  api.registerChannel(myChannel);
  api.registerProvider(myProvider);
  api.registerSearchProvider(mySearchProvider);
}
```

Four example plugins are included:

| Plugin | Type | Description |
| :--- | :--- | :--- |
| `hello-plugin` | Tool | Demo tool that greets by name |
| `duckduckgo-search` | Search Provider | Web search without API keys |
| `xiaomi-provider` | Model Provider | Xiaomi MiMo models (OpenAI/Anthropic compatible) |
| `qqbot-channel` | Channel | QQ Bot integration (C2C + group) |

### Skills System

Skills are prompt templates invoked via `/skill-name` in chat. Two formats:

**Single file** (`skills/weather.md`):

```markdown
---
name: weather
description: Get weather for a location
argument-hint: <city>
---

Check the weather for $ARGUMENTS using wttr.in
```

**Directory** (`skills/skill-creator/SKILL.md` + `agents/`, `references/`):
Contains sub-agent definitions, reference docs, scripts, and assets.

7 built-in skills: `commit`, `explain`, `refactor`, `review`, `test`, `weather`, `skill-creator`.

### Session Management

Sessions are stored as JSONL files under `~/.mini-claw/sessions/`:

- `sessions.json` -- metadata index
- `<session-key>.jsonl` -- one JSON line per message

A per-session promise-chain mutex prevents concurrent write corruption.

### Workspace Context

The system prompt is assembled from markdown files in `~/.mini-claw/workspace/`:

| File | Purpose | Budget |
| :--- | :--- | :--- |
| `SOUL.md` | Personality and tone | 5K chars |
| `AGENTS.md` | Tool usage rules | 10K chars |
| `USER.md` | User preferences | 3K chars |
| `MEMORY.md` | Long-term memory | 20K chars |
| `memory/*.md` | Daily memory notes | Today + yesterday |

Total budget: 150K characters.

## CLI Commands

```bash
mini-claw onboard              # Interactive setup wizard
mini-claw chat                 # Start TUI chat session
mini-claw gateway              # Start WebSocket gateway + CLI channel
mini-claw providers list       # List discovered provider plugins
mini-claw models list          # Show configured providers
mini-claw models auth add      # Add/update a provider interactively
mini-claw plugins list         # List loaded plugins
mini-claw skills list          # List available skills
mini-claw skills show <name>   # Show skill details
mini-claw skills create <name> # Create a new skill template
```

### TUI Slash Commands

| Command | Action |
| :--- | :--- |
| `/new` | Start a new session |
| `/clear` | Clear current session |
| `/model` | Switch model |
| `/skills` | List available skills |
| `/compact` | Manually compact conversation |
| `/quit` | Exit |
| `/help` | Show help |

## Built-in Tools

| Tool | Description |
| :--- | :--- |
| `echo` | Returns input text (testing) |
| `calculator` | Basic arithmetic |
| `date_time` | Time, timezone, formatting |
| `bash` | Shell execution with security sandbox |
| `web_fetch` | Fetch URL, convert HTML to Markdown |
| `web_search` | Delegate to registered search providers |

## Configuration

Config file: `~/.mini-claw/mini-claw.json`

```jsonc
{
  "gateway": { "port": 18789, "host": "127.0.0.1" },
  "agent": {
    "defaultProvider": "claude",
    "defaultModel": "claude-sonnet-4-5-20250929",
    "compaction": { "enabled": true, "maxMessages": 50, "maxInputTokens": 100000 },
    "maxToolRounds": 20
  },
  "plugins": { "enabled": true, "loadPaths": ["./extensions"] }
}
```

Use `MINI_CLAW_ENV=dev` to switch to `~/.mini-claw-dev/` for development.

## Extending

### Add a New Tool

Create `src/agent/tools/my-tool.ts`, implement the `AgentTool` interface, register in `src/agent/tools/index.ts`.

### Add a New Channel

Implement `ChannelPlugin` from `src/channels/types.ts`, register via `ChannelManager.register()`.

### Add a New Plugin

Create a directory under `extensions/` with:

- `mini-claw.plugin.json` -- manifest
- `index.ts` -- exports `register(api: PluginAPI)`

### Add a New Skill

Create a `.md` file in `skills/` with YAML frontmatter, or a directory with `SKILL.md` plus optional `agents/`, `references/`, `scripts/`, `assets/` subdirectories.

## Testing

```bash
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
pnpm lint           # Type check
```

8 test suites covering: agent runtime, bash tool, channels, compaction, context builder, context pruner, gateway, and session store.

## Tech Stack

- **Runtime**: Node.js >= 22, TypeScript (ESM)
- **AI**: `@anthropic-ai/sdk`, `openai`
- **WebSocket**: `ws`
- **Schemas**: `@sinclair/typebox`
- **CLI**: `commander`, `@clack/prompts`, `chalk`
- **TUI**: `@earendil-works/pi-tui`
- **Web**: React 19, Vite
- **Testing**: vitest
- **Package Manager**: pnpm

## License

MIT
