## Why

Test fixture for validating the ralph-loop workflow with NEEDS_REVIEW signal transition. This task should trigger a review step before completing.

## What Changes

Create a `review-needed.txt` file that requires review before completion.

## Capabilities

### New Capabilities

- `review-file`: Creates a review-needed.txt file that triggers the review workflow path
