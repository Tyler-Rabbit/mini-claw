import { Command } from "commander";
import { loadConfig } from "../../config/config.js";
import { AgentRuntime } from "../../agent/runtime.js";
import { ModelRouter } from "../../agent/model-router.js";
import { ToolRegistry } from "../../agent/tool-registry.js";
import { builtinTools } from "../../agent/tools/index.js";
import { SessionManager } from "../../sessions/manager.js";
import { SessionStore } from "../../sessions/store.js";
import { bootstrapPlugins } from "../../plugins/bootstrap.js";
import { getSessionsDir, getWorkspaceDir } from "../../config/paths.js";
import { ContextBuilder } from "../../workspace/context-builder.js";
import { runTuiChat } from "../tui-chat.js";

export function addChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session")
    .option("-c, --config <path>", "Config file path")
    .option("-p, --provider <provider>", "Model provider name")
    .option("-m, --model <model>", "Model to use")
    .action(async (options) => {
      const config = await loadConfig(options.config);
      const provider = options.provider ?? config.agent.defaultProvider;
      const providerModel = config.agent.providers?.[provider]?.model;
      const model = options.model ?? (config.agent.defaultModel || providerModel || "");

      // Bootstrap plugins
      const { providers, tools: pluginTools } = await bootstrapPlugins(config);

      // Setup model router
      const modelRouter = new ModelRouter(provider);
      for (const p of providers) {
        modelRouter.registerProvider(p);
      }

      // Setup tools
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

      // Setup agent
      const agent = new AgentRuntime({
        modelRouter,
        toolRegistry,
        sessionManager,
        maxToolRounds: config.agent.maxToolRounds,
        defaultProvider: provider,
        defaultModel: model,
        systemPrompt: async (sessionKey) => contextBuilder.buildSystemPrompt(sessionKey),
      });

      // Launch TUI chat
      await runTuiChat({ agent, provider, model });
    });
}
