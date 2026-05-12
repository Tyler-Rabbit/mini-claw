import { Command } from "commander";
import { loadConfig } from "../../config/config.js";
import { AgentRuntime } from "../../agent/runtime.js";
import { ModelRouter } from "../../agent/model-router.js";
import { ToolRegistry } from "../../agent/tool-registry.js";
import { builtinTools } from "../../agent/tools/index.js";
import { createInvokeSkillTool } from "../../agent/tools/invoke-skill.js";
import { SessionManager } from "../../sessions/manager.js";
import { SessionStore } from "../../sessions/store.js";
import { bootstrapPlugins } from "../../plugins/bootstrap.js";
import { getSessionsDir, getWorkspaceDir } from "../../config/paths.js";
import { ContextBuilder } from "../../workspace/context-builder.js";
import { SkillRegistry } from "../../skills/registry.js";
import { SkillExecutor } from "../../skills/executor.js";
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

      // Bootstrap plugins and skills
      const { providers, tools: pluginTools, skills } = await bootstrapPlugins(config);

      // Setup model router
      const modelRouter = new ModelRouter(provider);
      for (const p of providers) {
        modelRouter.registerProvider(p);
      }

      // Setup skills (already loaded from bootstrap)
      const skillRegistry = new SkillRegistry();
      for (const skill of skills) {
        skillRegistry.register(skill);
      }

      // Skill invocation callback (set by TUI)
      let onSkillInvoked: ((skillName: string, args: string[]) => void) | undefined;

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

      // Skill list for system prompt
      const skillList = skills
        .map((s) => `  - /${s.id}: ${s.description}${s.argumentHint ? ` (args: ${s.argumentHint})` : ""}`)
        .join("\n");

      // Setup agent with skill-aware system prompt
      const agent = new AgentRuntime({
        modelRouter,
        toolRegistry,
        sessionManager,
        maxToolRounds: config.agent.maxToolRounds,
        defaultProvider: provider,
        defaultModel: model,
        systemPrompt: async (sessionKey) => {
          const basePrompt = await contextBuilder.buildSystemPrompt(sessionKey);
          if (skills.length === 0) return basePrompt;
          return `${basePrompt}

## Available Skills

You have access to the following skills. When a user's request matches a skill's purpose, use the invoke_skill tool to handle it with the appropriate skill.

${skillList}

To invoke a skill, call the invoke_skill tool with the skill name and arguments.`;
        },
      });

      // Setup skill executor
      const skillExecutor = new SkillExecutor({
        agentRuntime: agent,
        skillRegistry,
      });

      // Register invoke_skill tool (needs callback set by TUI)
      const invokeSkillTool = createInvokeSkillTool(
        skillExecutor,
        skillRegistry,
        (skillName, args) => onSkillInvoked?.(skillName, args)
      );
      toolRegistry.register(invokeSkillTool);

      // Launch TUI chat with skills support
      await runTuiChat({
        agent,
        provider,
        model,
        sessionManager,
        skillExecutor,
        setSkillInvokedCallback: (cb) => { onSkillInvoked = cb; },
      });
    });
}
