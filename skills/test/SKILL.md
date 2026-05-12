---
name: test
description: Write or run tests for code
argument-hint: "[file-or-module]"
allowed-tools: Read, Write, Edit, Bash(npm:*), Bash(pnpm:*), Bash(vitest:*), Glob, Grep
---

Help with tests for $ARGUMENTS:

1. **Check Existing Tests**
   - Look for existing test files related to the target
   - Review current test coverage

2. **Run Existing Tests**
   - Run the relevant test suite
   - Report any failures

3. **Write New Tests** (if needed)
   - Identify untested code paths
   - Write tests following project conventions
   - Cover edge cases and error scenarios
   - Use appropriate mocking/stubbing

4. **Test Quality**
   - Tests should be clear and readable
   - Each test should test one thing
   - Use descriptive test names
   - Follow AAA pattern (Arrange, Act, Assert)

Follow the project's testing framework and conventions (check for vitest, jest, mocha, etc.).
