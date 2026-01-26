# My Agent

My claude settings

## Global setup Instructions

If you want to leverage this config in your Claude globally for all projects:

```sh
## BACKUP YOUR ~/.claude FIRST !!!
cp -R ~/.claude ~/.claude-bkp

# Remove existing targets (symlinks or directories) before linking
rm -rf ~/.claude/commands ~/.claude/skills ~/.claude/songs

ln -sf $(pwd)/AGENTS.md ~/.claude/CLAUDE.md
ln -sfn $(pwd)/.claude/commands ~/.claude/commands
ln -sfn $(pwd)/.claude/skills ~/.claude/skills
ln -sf $(pwd)/.claude/settings.json ~/.claude/settings.json
ln -sfn $(pwd)/.claude/songs ~/.claude/songs
```
