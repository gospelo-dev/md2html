# OpenCode

There is no OpenCode-specific copy of the skill. OpenCode has first-party
skill support and scans the same locations that `install.py` populates:

| Scope | Paths scanned |
| --- | --- |
| Project | `.opencode/{skill,skills}/**/SKILL.md`, `.claude/skills/**/SKILL.md`, `.agents/skills/**/SKILL.md` |
| Global | `~/.config/opencode/{skill,skills}/**/SKILL.md`, `~/.claude/skills/**/SKILL.md`, `~/.agents/skills/**/SKILL.md` |

Either run the installer:

```bash
python skills/claude/gospelo-md2html/scripts/install.py --project /path/to/repo
```

or point OpenCode at this clone in `opencode.json` and skip copying:

```json
{
  "skills": {
    "paths": ["~/src/md2html/skills/claude"]
  }
}
```

The skill body (`skills/claude/gospelo-md2html/SKILL.md`) uses only the
portable core of the Agent Skills standard, so it reads the same in every agent.
