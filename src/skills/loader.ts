import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename, extname, relative } from "node:path";
import type {
  Skill,
  SkillFrontmatter,
  SubAgent,
  ReferenceDoc,
  ScriptFile,
  AssetFile,
} from "./types.js";

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns the frontmatter object and the content after the frontmatter.
 */
export function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, yamlStr, body] = match;
  const frontmatter: SkillFrontmatter = {};

  // Simple YAML parser for flat key-value pairs
  for (const line of yamlStr.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | boolean = line.slice(colonIndex + 1).trim();

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle boolean values
    if (value === "true") value = true;
    if (value === "false") value = false;

    (frontmatter as Record<string, unknown>)[key] = value;
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Generate a skill ID from a filename.
 * Converts "my-skill.md" to "my-skill"
 */
function skillIdFromFilename(filename: string): string {
  const ext = extname(filename);
  return basename(filename, ext)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Parse a markdown file into a Skill object.
 */
export function parseSkill(content: string, filePath: string): Skill {
  const { frontmatter, body } = parseFrontmatter(content);

  const id = frontmatter.name || skillIdFromFilename(basename(filePath));
  const name = frontmatter.name || id;
  const description = frontmatter.description || `Skill: ${id}`;

  // Parse allowed-tools into array
  let allowedTools: string[] | undefined;
  if (frontmatter["allowed-tools"]) {
    allowedTools = frontmatter["allowed-tools"]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return {
    id,
    name,
    description,
    argumentHint: frontmatter["argument-hint"],
    allowedTools,
    model: frontmatter.model,
    disableModelInvocation: frontmatter["disable-model-invocation"] ?? false,
    promptTemplate: body,
    sourcePath: filePath,
    isDirectory: false,
  };
}

/**
 * Resolve skill arguments in a prompt template.
 * Supports: $1, $2, ..., $N for positional args, $ARGUMENTS for all args.
 */
export function resolveSkillArgs(
  template: string,
  args: string[]
): string {
  let resolved = template;

  // Replace $ARGUMENTS with all args joined by space
  resolved = resolved.replace(/\$ARGUMENTS/g, args.join(" "));

  // Replace positional args $1, $2, etc.
  for (let i = 0; i < args.length; i++) {
    const pattern = new RegExp(`\\$${i + 1}`, "g");
    resolved = resolved.replace(pattern, args[i]);
  }

  return resolved;
}

/**
 * Load a single skill from a file path.
 */
export async function loadSkillFromFile(filePath: string): Promise<Skill> {
  const content = await readFile(filePath, "utf-8");
  return parseSkill(content, filePath);
}

/**
 * Load all skills from a directory.
 * Supports both single .md files and directory-based skills (containing SKILL.md).
 */
export async function loadSkillsFromDirectory(
  dirPath: string
): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Check if this is a directory-based skill (contains SKILL.md)
        const dirSkill = await loadDirectorySkill(fullPath);
        if (dirSkill) {
          skills.push(dirSkill);
        } else {
          // Recursively load from subdirectories
          const subSkills = await loadSkillsFromDirectory(fullPath);
          skills.push(...subSkills);
        }
      } else if (entry.isFile() && extname(entry.name) === ".md") {
        try {
          const skill = await loadSkillFromFile(fullPath);
          skills.push(skill);
        } catch (err) {
          console.warn(`[skills] failed to load ${fullPath}:`, err);
        }
      }
    }
  } catch (err) {
    // Directory might not exist yet
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return skills;
}

/**
 * Load skills from multiple directories.
 * Earlier directories have higher priority — if a skill name appears
 * in multiple sources, the first one wins.
 */
export async function loadSkillsWithPriority(
  directories: string[]
): Promise<Skill[]> {
  const seen = new Map<string, Skill>();

  for (const dir of directories) {
    const skills = await loadSkillsFromDirectory(dir);
    for (const skill of skills) {
      if (!seen.has(skill.id)) {
        seen.set(skill.id, skill);
      }
    }
  }

  return [...seen.values()];
}

/**
 * Load skills from multiple directories (no deduplication).
 */
export async function loadSkills(
  directories: string[]
): Promise<Skill[]> {
  const allSkills: Skill[] = [];

  for (const dir of directories) {
    const skills = await loadSkillsFromDirectory(dir);
    allSkills.push(...skills);
  }

  return allSkills;
}

/**
 * Load sub-agents from an agents/ directory.
 */
export async function loadSubAgents(agentsDir: string): Promise<SubAgent[]> {
  const agents: SubAgent[] = [];

  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name) === ".md") {
        const filePath = join(agentsDir, entry.name);
        const content = await readFile(filePath, "utf-8");
        agents.push({
          name: basename(entry.name, ".md"),
          prompt: content.trim(),
          sourcePath: filePath,
        });
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return agents;
}

/**
 * Load reference documents from a references/ directory.
 */
export async function loadReferences(referencesDir: string): Promise<ReferenceDoc[]> {
  const references: ReferenceDoc[] = [];

  try {
    const entries = await readdir(referencesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name) === ".md") {
        const filePath = join(referencesDir, entry.name);
        const content = await readFile(filePath, "utf-8");
        references.push({
          name: basename(entry.name, ".md"),
          content: content.trim(),
          sourcePath: filePath,
        });
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return references;
}

/**
 * Load scripts from a scripts/ directory.
 */
export async function loadScripts(scriptsDir: string): Promise<ScriptFile[]> {
  const scripts: ScriptFile[] = [];

  try {
    const entries = await readdir(scriptsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(scriptsDir, entry.name);
        const content = await readFile(filePath, "utf-8");
        scripts.push({
          name: entry.name,
          content: content.trim(),
          sourcePath: filePath,
        });
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return scripts;
}

/**
 * Load asset files from an assets/ directory.
 */
export async function loadAssets(assetsDir: string): Promise<AssetFile[]> {
  const assets: AssetFile[] = [];

  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(assetsDir, entry.name);
        assets.push({
          name: entry.name,
          path: relative(assetsDir, filePath),
          absolutePath: filePath,
        });
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return assets;
}

/**
 * Load a directory-based skill.
 * A directory skill must contain a SKILL.md file.
 */
export async function loadDirectorySkill(dirPath: string): Promise<Skill | null> {
  const skillMdPath = join(dirPath, "SKILL.md");

  try {
    await stat(skillMdPath);
  } catch {
    return null; // Not a directory skill
  }

  const content = await readFile(skillMdPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);

  const id = frontmatter.name || basename(dirPath)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const name = frontmatter.name || id;
  const description = frontmatter.description || `Skill: ${id}`;

  // Parse allowed-tools into array
  let allowedTools: string[] | undefined;
  if (frontmatter["allowed-tools"]) {
    allowedTools = frontmatter["allowed-tools"]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // Load supporting files
  const [subAgents, references, scripts, assets] = await Promise.all([
    loadSubAgents(join(dirPath, "agents")),
    loadReferences(join(dirPath, "references")),
    loadScripts(join(dirPath, "scripts")),
    loadAssets(join(dirPath, "assets")),
  ]);

  return {
    id,
    name,
    description,
    argumentHint: frontmatter["argument-hint"],
    allowedTools,
    model: frontmatter.model,
    disableModelInvocation: frontmatter["disable-model-invocation"] ?? false,
    promptTemplate: body,
    sourcePath: dirPath,
    isDirectory: true,
    subAgents: subAgents.length > 0 ? subAgents : undefined,
    references: references.length > 0 ? references : undefined,
    scripts: scripts.length > 0 ? scripts : undefined,
    assets: assets.length > 0 ? assets : undefined,
  };
}
