---
name: commit
description: Create a well-formatted git commit
argument-hint: "[optional-scope]"
allowed-tools: Bash(git:*)
---

Create a git commit with a well-formatted message.

Steps:

1. **Review Changes**
   - Check `git status` for staged and unstaged files
   - Review `git diff` to understand the changes

2. **Stage Changes**
   - Stage appropriate files
   - Don't stage unrelated changes

3. **Write Commit Message**
   - Use conventional commit format: `type(scope): description`
   - Types: feat, fix, docs, style, refactor, test, chore
   - Keep subject line under 50 characters
   - Add body if needed (wrap at 72 characters)
   - Reference issues if applicable

4. **Commit**
   - Create the commit with the formatted message

Example formats:
- `feat(auth): add login endpoint`
- `fix(parser): handle empty input`
- `docs(readme): update installation steps`
