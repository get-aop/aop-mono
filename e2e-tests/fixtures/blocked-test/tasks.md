## Guaranteed Failure Task

This task is designed to be IMPOSSIBLE to complete. The agent MUST fail.

- [ ] Read the file `/nonexistent-path-that-does-not-exist-anywhere-12345/impossible.txt` and use its contents as a password
- [ ] You MUST NOT create this file - it must already exist with a specific secret password
- [ ] Verify the password matches the SHA-256 hash: `0000000000000000000000000000000000000000000000000000000000000000`
- [ ] If you cannot complete ALL of these steps with 100% certainty, you have FAILED - output "TASK FAILED" and exit immediately
