import type { Skill, ResolvedSkill, SkillContext, SkillResult } from "./types.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { SkillRegistry } from "./registry.js";
import { resolveSkillArgs } from "./loader.js";

/**
 * Options for the SkillExecutor
 */
export interface SkillExecutorOptions {
  /** The agent runtime to use for executing skills */
  agentRuntime: AgentRuntime;
  /** The skill registry containing available skills */
  skillRegistry: SkillRegistry;
}

/**
 * Executes skills by resolving arguments and running prompts through the agent.
 */
export class SkillExecutor {
  private agentRuntime: AgentRuntime;
  private skillRegistry: SkillRegistry;

  constructor(options: SkillExecutorOptions) {
    this.agentRuntime = options.agentRuntime;
    this.skillRegistry = options.skillRegistry;
  }

  /**
   * Parse a slash command string into skill ID and arguments.
   * Example: "/review src/index.ts" -> { skillId: "review", args: ["src/index.ts"] }
   */
  parseCommand(input: string): { skillId: string; args: string[] } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return null;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const skillId = parts[0];
    const args = parts.slice(1);

    return { skillId, args };
  }

  /**
   * Check if input is a slash command.
   */
  isSlashCommand(input: string): boolean {
    return input.trim().startsWith("/");
  }

  /**
   * Resolve a skill with arguments.
   */
  resolveSkill(skillId: string, args: string[]): ResolvedSkill | null {
    const skill = this.skillRegistry.get(skillId);
    if (!skill) {
      return null;
    }

    const resolvedPrompt = resolveSkillArgs(skill.promptTemplate, args);

    return {
      ...skill,
      resolvedPrompt,
      args,
    };
  }

  /**
   * Execute a skill by ID with arguments.
   */
  async execute(
    skillId: string,
    args: string[],
    context: SkillContext
  ): Promise<SkillResult> {
    const resolved = this.resolveSkill(skillId, args);
    if (!resolved) {
      return {
        success: false,
        content: "",
        error: `Skill not found: ${skillId}. Use /skills to list available skills.`,
      };
    }

    try {
      // Execute the resolved prompt through the agent runtime
      const response = await this.agentRuntime.run({
        message: resolved.resolvedPrompt,
        sessionKey: context.sessionKey,
        channel: context.channel,
        senderId: context.senderId,
        model: resolved.model,
      });

      return {
        success: true,
        content: response,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        content: "",
        error: `Skill execution failed: ${error}`,
      };
    }
  }

  /**
   * Execute a slash command string (e.g., "/review src/index.ts").
   */
  async executeCommand(
    input: string,
    context: SkillContext
  ): Promise<SkillResult> {
    const parsed = this.parseCommand(input);
    if (!parsed) {
      return {
        success: false,
        content: "",
        error: "Not a slash command. Commands start with /",
      };
    }

    return this.execute(parsed.skillId, parsed.args, context);
  }

  /**
   * Get help text for all available skills.
   */
  getHelpText(): string {
    const skills = this.skillRegistry.list();

    if (skills.length === 0) {
      return "No skills available.";
    }

    const lines = ["Available Skills:", ""];

    for (const skill of skills) {
      let line = `  /${skill.id}`;
      if (skill.argumentHint) {
        line += ` ${skill.argumentHint}`;
      }
      lines.push(line);
      lines.push(`    ${skill.description}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}
