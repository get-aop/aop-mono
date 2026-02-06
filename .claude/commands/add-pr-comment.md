# Add PR Review Comment

Add inline comments to a PR based on findings from a previous `/code-review` run.

## Usage

```
/add-pr-comment <issue_numbers>
```

**Arguments**: Space-separated issue numbers from the code review findings table (e.g., `2` or `1 2 3`)

## Workflow

1. **Locate the code review**: Find the most recent `/code-review` output in this conversation that contains a findings table
2. **Extract the specified issues**: Get the issue(s) matching the provided number(s) from the findings table
3. **Get PR info**: Determine the PR number from the current branch using `gh pr list --head <branch>`
4. **Get commit SHA**: Get the head commit SHA using `gh pr view <number> --json headRefOid`
5. **Add inline comments**: For each issue, create a PR review comment using the GitHub API

## GitHub API

**IMPORTANT**: Use `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` endpoint (NOT `/reviews`).

This creates a clean inline comment without a review body message polluting the conversation.

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  --method POST \
  -f commit_id="<sha>" \
  -f path="<file_path>" \
  -f line=<line_number> \
  -f body="<comment>"
```

## Comment Style

- **Short and concise**: 1-2 sentences max
- **Problem only**: Describe what's wrong, never suggest solutions
- **No preamble**: Jump straight to the issue
- **Use backticks**: For code references like `functionName()` or `variableName`

## Example

Given this findings table from `/code-review`:

| # | Cat | Issue | Location | Confidence |
|---|-----|-------|----------|------------|
| 1 | S   | API key exposed in config | src/config.ts:42 | 95 |
| 2 | Q   | Redundant DB query | src/services/sync.ts:64 | 85 |

Running `/add-pr-comment 2` would:
1. Extract issue #2: "Redundant DB query" at `src/services/sync.ts:64`
2. Find the PR for current branch
3. Add an inline comment at line 64 of `src/services/sync.ts`

## Output

After adding comments, report:
- PR number and URL
- List of comments added with file:line
