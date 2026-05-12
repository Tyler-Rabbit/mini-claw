---
name: explain
description: Explain how code works in plain language
argument-hint: "[file-or-code-snippet]"
allowed-tools: Read, Glob, Grep
---

Explain the code in $ARGUMENTS in clear, plain language.

Structure your explanation as:

1. **Overview**: What does this code do? (1-2 sentences)

2. **Key Components**: Break down the main parts:
   - Functions/methods and their purposes
   - Important variables and data structures
   - Control flow and logic

3. **How It Works**: Walk through the execution flow step by step

4. **Dependencies**: What does this code depend on? What depends on it?

5. **Notable Patterns**: Any interesting patterns, techniques, or design decisions

Adjust the level of detail based on complexity. For simple code, keep it brief. For complex code, be thorough.
