# My Agent

My claude settings

## Global setup Instructions

If you want to leverage this config in your Claude globally for all projects:

```sh
## BACKUP YOUR ~/.claude FIRST !!!
cp -R ~/.claude .claude-bkp
ln -sf $(pwd)/AGENTS.md ~/.claude/CLAUDE.md
ln -sf $(pwd)/.claude/commands ~/.claude/commands
ln -sf $(pwd)/.claude/skills ~/.claude/skills
ln -sf $(pwd)/.claude/settings.json ~/.claude/settings.json
ln -sf $(pwd)/.claude/songs ~/.claude/songs
```
