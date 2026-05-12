---
name: review
description: Review code for quality, bugs, and improvements
argument-hint: "[file-or-directory]"
allowed-tools: Read, Bash(git:*), Glob, Grep
---

Please review the code in $ARGUMENTS for:

1. **Bugs and Logic Errors**
   - Identify any potential bugs or logic errors
   - Check for edge cases that might not be handled

2. **Code Quality**
   - Naming conventions and clarity
   - Code organization and structure
   - DRY (Don't Repeat Yourself) violations

3. **Performance**
   - Obvious performance issues
   - Unnecessary computations or allocations

4. **Security**
   - Common security vulnerabilities
   - Input validation issues
   - Secret/credential exposure

5. **Best Practices**
   - Language/framework best practices
   - Error handling patterns
   - Type safety (if applicable)

Provide specific, actionable feedback with file paths and line numbers where applicable.
