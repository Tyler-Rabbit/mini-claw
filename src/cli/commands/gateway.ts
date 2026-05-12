import { Command } from "commander";
import { loadConfig } from "../../config/config.js";
import { GatewayServer } from "../../gateway/server.js";
import { AgentRuntime } from "../../agent/runtime.js";
import { ModelRouter } from "../../agent/model-router.js";
import { ToolRegistry } from "../../agent/tool-registry.js";
import { builtinTools } from "../../agent/tools/index.js";
import { SessionManager } from "../../sessions/manager.js";
import { SessionStore } from "../../sessions/store.js";
import { ChannelManager } from "../../channels/manager.js";
import { CliChannel } from "../../channels/cli-channel/index.js";
import { bootstrapPlugins } from "../../plugins/bootstrap.js";
import { getSessionsDir, getWorkspaceDir } from "../../config/paths.js";
import { ContextBuilder } from "../../workspace/context-builder.js";
import type { AgentParams, AbortParams } from "../../gateway/protocol/types.js";

export function addGatewayCommand(program: Command): void {
  program
    .command("gateway")
    .description("Start the mini-claw gateway server")
    .option("-p, --port <port>", "Port to listen on")
    .option("-c, --config <path>", "Config file path")
    .option("--no-cli", "Disable CLI channel")
    .action(async (options) => {
      const config = await loadConfig(options.config);
      const port = options.port ? parseInt(options.port) : config.gateway.port;

      // Bootstrap plugins (loads builtin + external providers, tools, channels)
      const { providers, tools: pluginTools, channels: pluginChannels } = await bootstrapPlugins(config);

      // Setup model router
      const modelRouter = new ModelRouter(config.agent.defaultProvider);
      for (const p of providers) {
        modelRouter.registerProvider(p);
      }

      // Setup tools (builtin + plugin-registered)
      const toolRegistry = new ToolRegistry();
      for (const tool of builtinTools) toolRegistry.register(tool);
      for (const tool of pluginTools) toolRegistry.register(tool);

      // Setup sessions
      const sessionStore = new SessionStore(getSessionsDir());
      await sessionStore.init();
      const sessionManager = new SessionManager(sessionStore);

      // Setup workspace context
      const contextBuilder = new ContextBuilder(getWorkspaceDir());
      await contextBuilder.init();

      // Setup agent runtime
      const agent = new AgentRuntime({
        modelRouter,
        toolRegistry,
        sessionManager,
        maxToolRounds: config.agent.maxToolRounds,
        defaultProvider: config.agent.defaultProvider,
        defaultModel: config.agent.defaultModel,
        systemPrompt: async (sessionKey) => contextBuilder.buildSystemPrompt(sessionKey),
      });

      // Setup gateway
      const gateway = new GatewayServer();

      const activeRuns = new Map<string, AbortController>();

      // Register agent handler on gateway
      gateway.getRouter().register("agent", async (ctx) => {
        const params = ctx.params as AgentParams & { id: string };
        const requestId = params.id;

        const ac = new AbortController();
        activeRuns.set(requestId, ac);

        try {
          ctx.send({
            type: "res",
            id: requestId,
            ok: true,
            payload: { status: "accepted" },
          });

          let fullResponse = "";
          await agent.run(
            {
              message: params.message,
              sessionKey: params.sessionKey,
              model: params.model,
              signal: ac.signal,
            },
            (event) => {
              if (event.type === "text" && event.content) {
                fullResponse += event.content;
                ctx.send({
                  type: "event",
                  event: "agent:stream",
                  payload: { runId: requestId, text: event.content, done: false },
                });
              }
              if (event.type === "tool_use") {
                ctx.send({
                  type: "event",
                  event: "agent:tool_use",
                  payload: {
                    runId: requestId,
                    toolName: event.toolName,
                    toolArgs: event.toolArgs,
                    toolCallId: event.toolCallId,
                  },
                });
              }
              if (event.type === "tool_result") {
                ctx.send({
                  type: "event",
                  event: "agent:tool_result",
                  payload: {
                    runId: requestId,
                    toolName: event.toolName,
                    toolResult: event.toolResult,
                    toolCallId: event.toolCallId,
                  },
                });
              }
              if (event.type === "done") {
                ctx.send({
                  type: "event",
                  event: "agent:stream",
                  payload: { runId: requestId, text: "", done: true },
                });
              }
            }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          ctx.send({
            type: "event",
            event: "agent:error",
            payload: { runId: requestId, error: message },
          });
        } finally {
          activeRuns.delete(requestId);
        }
      });

      // Register agent:abort handler on gateway
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

      // Start gateway
      await gateway.start({ port, host: config.gateway.host });

      // Optionally start CLI channel
      if (options.cli !== false) {
        const channelManager = new ChannelManager();
        const cliChannel = new CliChannel();
        channelManager.register(cliChannel);
        // Register plugin channels
        for (const ch of pluginChannels) {
          channelManager.register(ch);
        }

        await channelManager.startAll({
          agent,
          onMessage: async (msg) => {
            if (msg.text === "/clear") {
              await sessionManager.clear(msg.sessionKey);
              return "Session cleared.";
            }

            let response = "";
            await agent.run(
              { message: msg.text, sessionKey: msg.sessionKey, channel: msg.channel, senderId: msg.senderId },
              (event) => {
                if (event.type === "text" && event.content) {
                  response += event.content;
                }
              }
            );
            return response;
          },
        });
      }

      // Handle graceful shutdown
      const shutdown = async () => {
        console.log("\n[main] shutting down...");
        await gateway.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
