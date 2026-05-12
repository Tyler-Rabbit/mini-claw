---
name: refactor
description: Refactor code for better structure and readability
argument-hint: "[file-or-function]"
allowed-tools: Read, Write, Edit, Bash(pnpm:*), Glob, Grep
---

Refactor the code in $ARGUMENTS to improve:

1. **Readability**
   - Clear naming for variables, functions, and classes
   - Consistent code style
   - Appropriate comments where needed

2. **Structure**
   - Single Responsibility Principle
   - Proper separation of concerns
   - Reduce nesting and complexity

3. **Maintainability**
   - Remove dead code
   - Extract reusable functions/components
   - Simplify complex logic

4. **Type Safety** (if TypeScript)
   - Proper type annotations
   - Avoid `any` types
   - Use discriminated unions where appropriate

**Important**:
- Preserve existing behavior (no functional changes)
- Run tests after refactoring to ensure nothing breaks
- Make incremental changes, not massive rewrites
- Explain the reasoning behind each change
