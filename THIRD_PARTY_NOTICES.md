# Third-Party Notices

This repository's source code is licensed under the MIT License. This file
documents notable vendored or embedded third-party material and the intended
provenance for shipped non-code assets.

## Vendored Skills

The repo vendors a local skill bundle under `.claude/skills/` and `.codex/skills/`
so task workflows do not depend on globally installed skills.

- Source: `obra/superpowers`
- Upstream repository: `https://github.com/obra/superpowers`
- Upstream license: MIT
- Notes: Some files are copied directly, while some are adapted for AOP-specific
  paths and workflow behavior.

The AOP-specific brainstorming variant lives under:

- `.claude/skills/aop-brainstorming/`
- `.codex/skills/aop-brainstorming/`

and is based on the upstream `brainstorming` materials from the same MIT-licensed
 `obra/superpowers` repository.

## Embedded Font Material

`docs/branding/moodboard.svg` contains an embedded copy of Geist Mono metadata and
license text.

- Font family: Geist Mono
- Upstream project: `vercel/geist-font`
- License family noted in the embedded metadata: SIL Open Font License 1.1

This branding document is reference material only and is not part of the runtime
application bundle.

## Packaged Runtime Assets

The current repo ships a CLI and web dashboard only.

If future release bundles add packaged icons, fonts, or other non-code assets,
document their source URL and applicable license in this file before
distribution.
