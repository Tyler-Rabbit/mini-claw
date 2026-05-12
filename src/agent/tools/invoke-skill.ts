import { Type } from "@sinclair/typebox";
import type { AgentTool, ToolResult } from "../types.js";
import type { SkillExecutor } from "../../skills/executor.js";
import type { SkillRegistry } from "../../skills/registry.js";

/**
 * Creates the invoke_skill tool.
 * This tool allows the agent to automatically invoke skills based on user requests.
 */
export function createInvokeSkillTool(
  skillExecutor: SkillExecutor,
  skillRegistry: SkillRegistry,
  onSkillInvoked?: (skillName: string, args: string[]) => void
): AgentTool {
  return {
    name: "invoke_skill",
    description: `Invoke a skill (slash command) to handle specialized tasks. Available skills:\n${
      skillRegistry.list()
        .map((s) => `  - /${s.id}: ${s.description}${s.argumentHint ? ` (args: ${s.argumentHint})` : ""}`)
        .join("\n")
    }`,
    parameters: Type.Object({
      skill: Type.String({
        description: "The skill name to invoke (without the leading /)",
      }),
      args: Type.Array(Type.String(), {
        description: "Arguments to pass to the skill",
        default: [],
      }),
    }),
    execute: async ({ args }): Promise<ToolResult> => {
      const skillName = args.skill as string;
      const skillArgs = (args.args as string[]) ?? [];

      const skill = skillRegistry.get(skillName);
      if (!skill) {
        const available = skillRegistry.list().map((s) => `/${s.id}`).join(", ");
        return {
          type: "error",
          content: `Skill not found: /${skillName}. Available skills: ${available}`,
        };
      }

      // Notify UI about skill invocation
      onSkillInvoked?.(skillName, skillArgs);

      // Resolve the skill prompt with arguments
      const { resolveSkillArgs } = await import("../../skills/loader.js");
      const resolvedPrompt = resolveSkillArgs(skill.promptTemplate, skillArgs);

      // Inject the resolved prompt as system instructions for the agent.
      // The agent will follow these instructions and execute the actual work.
      return {
        type: "text",
        content: `[Skill /${skillName} activated for: ${skillArgs.join(" ")}]\n\nFollow these instructions and execute them now. Do NOT repeat the instructions back — just do the work:\n\n${resolvedPrompt}`,
      };
    },
  };
}
