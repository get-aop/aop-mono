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
5. **Get the PR diff**: Run `gh pr diff <number>` and save to a temp file
6. **Validate and resolve line numbers**: For each finding, check if the reported line is within a diff hunk (see Line Resolution below)
7. **Add inline comments**: For each issue, create a PR review comment using the GitHub API

## Line Resolution

The `/code-review` reports **file line numbers**, but GitHub only allows inline comments on lines **within diff hunks**. You MUST validate each line before posting.

For each finding:

1. **Parse the diff** for the target file to extract all diff hunk ranges (the `@@ -a,b +c,d @@` headers define which lines are commentable)
2. **Check if the reported line falls within a diff hunk range** on the new file side (the `+c,d` range)
3. **If the line IS in a hunk**: use it directly
4. **If the line is NOT in a hunk**: search the diff for the nearest changed line in the same file that is contextually related to the finding. Use that line instead.
5. **If no changed line exists in that file**: post a general PR comment instead using `gh pr comment <number> --body "<comment>"` (NOT an inline comment)

## GitHub API

**IMPORTANT**: Use `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` endpoint (NOT `/reviews`).

This creates a clean inline comment without a review body message polluting the conversation.

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments \
  --method POST \
  -f commit_id="<sha>" \
  -f path="<file_path>" \
  -F line=<line_number> \
  -f side="RIGHT" \
  -f subject_type="line" \
  -f body="<comment>"
```

**Parameter notes**:
- `-F line=N` (capital F) sends line as integer — `-f` sends as string and will be rejected
- `side="RIGHT"` targets the new file side of the diff
- `subject_type="line"` tells GitHub you're using line-based positioning

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
3. Get the PR diff and verify line 64 of `src/services/sync.ts` is within a diff hunk
4. If line 64 is not in a hunk, find the nearest changed line in that file related to the DB query
5. Add an inline comment at the resolved line

## Output

After adding comments, report:
- PR number and URL
- List of comments added with file:line (note any lines that were adjusted from the original finding)
