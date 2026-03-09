# External References

This directory keeps explicit pointers to the upstream libraries that historically informed or accompanied AOP's vendored skill setup.

These references come from the February 3, 2026 repository state (`7e50435`), where the repo tracked the following external sources:

| Path | Upstream | Notes |
| --- | --- | --- |
| `external/superpowers` | `https://github.com/obra/superpowers` | Historical reference library for general engineering workflow skills and patterns |
| `external/skills` | `https://github.com/anthropics/skills` | Historical Anthropic skills reference tracked alongside the local bundle |
| `external/claude-plugins-official` | `https://github.com/anthropics/claude-plugins-official` | Historical plugin reference used by the old Claude setup |
| `external/everything-claude-code` | `https://github.com/affaan-m/everything-claude-code` | Historical Claude Code reference library |

The repo-local skills under `.claude/skills/` and `.codex/skills/` are the supported runtime bundle for AOP. The entries above are source pointers only, kept so the provenance of the vendored skill setup remains visible.
