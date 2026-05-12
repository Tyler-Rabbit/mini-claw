/**
 * Skill system types for mini-claw.
 *
 * Skills can be:
 * 1. Single markdown files with YAML frontmatter
 * 2. Directories containing SKILL.md and supporting files
 */

/** YAML frontmatter metadata for a skill */
export interface SkillFrontmatter {
  /** Unique skill name (used as slash command: /skill-name) */
  name?: string;
  /** Human-readable description */
  description?: string;
  /** Argument hint shown in help (e.g., "[pr-number]") */
  "argument-hint"?: string;
  /** Comma-separated list of allowed tools */
  "allowed-tools"?: string;
  /** Model to use (e.g., "sonnet", "opus") */
  model?: string;
  /** Disable direct model invocation */
  "disable-model-invocation"?: boolean;
  /** Sub-agent names to load from agents/ directory */
  agents?: string[];
}

/** A sub-agent definition loaded from agents/ directory */
export interface SubAgent {
  /** Agent name (derived from filename) */
  name: string;
  /** Agent prompt/instructions */
  prompt: string;
  /** Source file path */
  sourcePath: string;
}

/** A reference document loaded from references/ directory */
export interface ReferenceDoc {
  /** Document name (derived from filename) */
  name: string;
  /** Document content */
  content: string;
  /** Source file path */
  sourcePath: string;
}

/** A script file loaded from scripts/ directory */
export interface ScriptFile {
  /** Script name (derived from filename) */
  name: string;
  /** Script content */
  content: string;
  /** Source file path */
  sourcePath: string;
  /** Whether the script is executable */
  executable?: boolean;
}

/** Static asset loaded from assets/ directory */
export interface AssetFile {
  /** Asset name (derived from filename) */
  name: string;
  /** Asset file path (relative to skill directory) */
  path: string;
  /** Absolute file path */
  absolutePath: string;
}

/** A parsed skill ready for execution */
export interface Skill {
  /** Unique identifier (derived from directory name or filename) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description shown in skill listing */
  description: string;
  /** Argument hint for help text */
  argumentHint?: string;
  /** Allowed tools (null means all tools allowed) */
  allowedTools?: string[];
  /** Model override */
  model?: string;
  /** Whether model invocation is disabled */
  disableModelInvocation?: boolean;
  /** The prompt template content (from SKILL.md) */
  promptTemplate: string;
  /** Source path (file or directory) */
  sourcePath: string;
  /** Whether this is a directory-based skill */
  isDirectory: boolean;
  /** Sub-agents (from agents/ directory) */
  subAgents?: SubAgent[];
  /** Reference documents (from references/ directory) */
  references?: ReferenceDoc[];
  /** Scripts (from scripts/ directory) */
  scripts?: ScriptFile[];
  /** Static assets (from assets/ directory) */
  assets?: AssetFile[];
}

/** Resolved skill with arguments substituted */
export interface ResolvedSkill extends Skill {
  /** The prompt with arguments substituted */
  resolvedPrompt: string;
  /** The arguments passed to the skill */
  args: string[];
}

/** Skill execution context */
export interface SkillContext {
  /** Current session key */
  sessionKey: string;
  /** Channel name */
  channel: string;
  /** Sender ID */
  senderId: string;
  /** Current working directory */
  cwd?: string;
}

/** Result of skill execution */
export interface SkillResult {
  /** Whether the skill executed successfully */
  success: boolean;
  /** Output content */
  content: string;
  /** Error message if failed */
  error?: string;
}
