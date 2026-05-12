import { Command } from "commander";
import { join, resolve } from "node:path";
import { loadSkillsFromDirectory } from "../../skills/loader.js";

export function addSkillsCommand(program: Command): void {
  const skills = program
    .command("skills")
    .description("Manage skills (slash commands)");

  skills
    .command("list")
    .description("List available skills")
    .option("-d, --dir <path>", "Skills directory path", "skills")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const skillsDir = resolve(options.dir);
      const loaded = await loadSkillsFromDirectory(skillsDir);

      if (options.json) {
        console.log(JSON.stringify(loaded, null, 2));
        return;
      }

      if (loaded.length === 0) {
        console.log("No skills found.");
        console.log(`\nSearched in: ${skillsDir}`);
        console.log("\nCreate .md files or directories with SKILL.md to define skills.");
        return;
      }

      console.log("\nAvailable Skills:");
      console.log("─".repeat(60));
      for (const skill of loaded) {
        const type = skill.isDirectory ? "[dir]" : "[file]";
        console.log(`  /${skill.id} ${type}`);
        console.log(`    ${skill.description}`);
        if (skill.argumentHint) {
          console.log(`    Usage: /${skill.id} ${skill.argumentHint}`);
        }
        if (skill.allowedTools) {
          console.log(`    Tools: ${skill.allowedTools.join(", ")}`);
        }
        if (skill.isDirectory) {
          const parts = [];
          if (skill.subAgents?.length) parts.push(`${skill.subAgents.length} agents`);
          if (skill.references?.length) parts.push(`${skill.references.length} refs`);
          if (skill.scripts?.length) parts.push(`${skill.scripts.length} scripts`);
          if (skill.assets?.length) parts.push(`${skill.assets.length} assets`);
          if (parts.length > 0) {
            console.log(`    Includes: ${parts.join(", ")}`);
          }
        }
        console.log();
      }
      console.log("─".repeat(60));
      console.log(`Total: ${loaded.length} skill(s)`);
    });

  skills
    .command("show <name>")
    .description("Show skill details")
    .option("-d, --dir <path>", "Skills directory path", "skills")
    .action(async (name, options) => {
      const skillsDir = resolve(options.dir);
      const loaded = await loadSkillsFromDirectory(skillsDir);
      const skill = loaded.find((s) => s.id === name);

      if (!skill) {
        console.error(`Skill not found: ${name}`);
        console.log("\nAvailable skills:");
        for (const s of loaded) {
          console.log(`  /${s.id}`);
        }
        process.exit(1);
      }

      console.log("\nSkill Details:");
      console.log("─".repeat(60));
      console.log(`Name:        /${skill.id}`);
      console.log(`Description: ${skill.description}`);
      console.log(`Type:        ${skill.isDirectory ? "Directory" : "File"}`);
      if (skill.argumentHint) {
        console.log(`Arguments:   ${skill.argumentHint}`);
      }
      if (skill.allowedTools) {
        console.log(`Tools:       ${skill.allowedTools.join(", ")}`);
      }
      if (skill.model) {
        console.log(`Model:       ${skill.model}`);
      }
      console.log(`Source:      ${skill.sourcePath}`);

      // Show directory structure if it's a directory skill
      if (skill.isDirectory) {
        console.log("─".repeat(60));
        console.log("\nDirectory Structure:");
        console.log(`${skill.sourcePath}/`);
        console.log("├── SKILL.md");

        if (skill.subAgents?.length) {
          console.log("├── agents/");
          for (const agent of skill.subAgents) {
            console.log(`│   └── ${agent.name}.md`);
          }
        }
        if (skill.references?.length) {
          console.log("├── references/");
          for (const ref of skill.references) {
            console.log(`│   └── ${ref.name}.md`);
          }
        }
        if (skill.scripts?.length) {
          console.log("├── scripts/");
          for (const script of skill.scripts) {
            console.log(`│   └── ${script.name}`);
          }
        }
        if (skill.assets?.length) {
          console.log("├── assets/");
          for (const asset of skill.assets) {
            console.log(`│   └── ${asset.name}`);
          }
        }
      }

      console.log("─".repeat(60));
      console.log("\nPrompt Template:");
      console.log("─".repeat(60));
      console.log(skill.promptTemplate);
      console.log("─".repeat(60));

      // Show sub-agents if any
      if (skill.subAgents?.length) {
        console.log("\nSub-Agents:");
        console.log("─".repeat(60));
        for (const agent of skill.subAgents) {
          console.log(`\n## ${agent.name}`);
          console.log(agent.prompt.slice(0, 200) + (agent.prompt.length > 200 ? "..." : ""));
        }
        console.log("─".repeat(60));
      }
    });

  skills
    .command("create <name>")
    .description("Create a new skill template")
    .option("-d, --dir <path>", "Skills directory path", "skills")
    .option("--description <desc>", "Skill description")
    .option("--directory", "Create a directory-based skill with SKILL.md")
    .action(async (name, options) => {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const skillsDir = resolve(options.dir);
      const description = options.description || `Skill: ${name}`;

      if (options.directory) {
        // Create directory-based skill
        const skillDir = join(skillsDir, name);
        await mkdir(skillDir, { recursive: true });

        // Create SKILL.md
        const skillMd = `---
name: ${name}
description: ${description}
argument-hint: "[arguments]"
---

Your skill prompt here.

Use $1, $2, etc. for positional arguments.
Use $ARGUMENTS for all arguments as a string.
`;
        await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf-8");

        // Create subdirectories
        await mkdir(join(skillDir, "agents"), { recursive: true });
        await mkdir(join(skillDir, "references"), { recursive: true });
        await mkdir(join(skillDir, "scripts"), { recursive: true });
        await mkdir(join(skillDir, "assets"), { recursive: true });

        console.log(`Created directory skill: ${skillDir}`);
        console.log("\nStructure created:");
        console.log(`${name}/`);
        console.log("├── SKILL.md");
        console.log("├── agents/");
        console.log("├── references/");
        console.log("├── scripts/");
        console.log("└── assets/");
      } else {
        // Create single file skill
        const filePath = join(skillsDir, `${name}.md`);
        await mkdir(skillsDir, { recursive: true });

        const template = `---
name: ${name}
description: ${description}
argument-hint: "[arguments]"
---

Your skill prompt here.

Use $1, $2, etc. for positional arguments.
Use $ARGUMENTS for all arguments as a string.
`;

        await writeFile(filePath, template, "utf-8");
        console.log(`Created skill: ${filePath}`);
      }

      console.log("\nEdit the files to customize your skill.");
    });
}
