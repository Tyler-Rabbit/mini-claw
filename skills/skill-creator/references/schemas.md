# Skill Frontmatter Schema

## Required Fields

```yaml
---
name: skill-name          # Unique identifier (lowercase, hyphens)
description: Description  # Human-readable description
---
```

## Optional Fields

```yaml
---
argument-hint: "[arg1] [arg2]"  # Argument format hint
allowed-tools: "Read, Write"    # Comma-separated allowed tools
model: "sonnet"                 # Model override
disable-model-invocation: true  # Disable direct model use
---
```

## Argument Placeholders

- `$ARGUMENTS` - All arguments as a single string
- `$1`, `$2`, etc. - Positional arguments
- `@path/to/file` - File references
- `` !`command` `` - Bash execution
