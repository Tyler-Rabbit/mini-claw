---
name: skill-creator
description: Create and manage skills for mini-claw
argument-hint: "[skill-name]"
allowed-tools: Read, Write, Edit, Bash(mkdir:*), Glob, Grep
---

Create a new skill for mini-claw based on the user's requirements.

## Skill Creation Process

1. **Analyze Requirements**
   - Understand what the skill should do
   - Determine if it needs sub-agents, scripts, or references
   - Choose between single file or directory structure

2. **Design Skill Structure**
   - For simple skills: single .md file
   - For complex skills: directory with SKILL.md and supporting files

3. **Create Skill Files**
   - Write SKILL.md with proper frontmatter
   - Create sub-agent prompts if needed
   - Add reference documents
   - Include utility scripts

4. **Validate Skill**
   - Ensure frontmatter is correct
   - Test prompt template with sample arguments
   - Verify all supporting files are in place

## Directory Structure (for complex skills)

```
skill-name/
├── SKILL.md         ← Core instruction
├── agents/          ← Sub-agent prompts
│   └── agent-name.md
├── references/      ← Reference materials
│   └── doc-name.md
├── scripts/         ← Utility scripts
│   └── script.py
└── assets/          ← Static resources
    └── template.html
```

## Arguments

- $ARGUMENTS: The skill name and any additional requirements

Use the analyzer agent to understand requirements and the grader agent to validate the result.
