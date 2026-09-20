# Quickstart

Get the gospelo-md2html skill running in **Claude Code**, **GitHub Copilot**, **Codex** or **OpenCode** in a few minutes.

日本語版は [QUICKSTART_ja.md](QUICKSTART_ja.md) を参照してください。

## Prerequisites

Supported platforms: **macOS / Linux / WSL2**

| Dependency | Required | Notes |
| --- | --- | --- |
| uv | yes | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.10+ | yes | uv installs it if missing; the script declares its own dependencies (PEP 723) |
| Chromium | yes | installed once by the skill's `setup` subcommand through Playwright |

No `pip install`, no virtualenv. Mermaid.js and Font Awesome are vendored.

## Install

The installer copies the skill into `.claude/skills/` and `.agents/skills/`, which covers Claude Code, Copilot, Codex, and OpenCode.

**From this repository:**

```bash
git clone https://github.com/gospelo-dev/md2html.git
python md2html/skills/claude/gospelo-md2html/scripts/install.py --project /path/to/your/repo
```

**From a ZIP** (if someone handed you `gospelo-md2html.zip`):

```bash
unzip gospelo-md2html.zip
python gospelo-md2html/scripts/install.py --project /path/to/your/repo
```

Use `--user` instead of `--project` to install once for all projects on your machine, `--symlink` to link back to the clone while developing, and `--force` to replace an existing installation.

**Then, once per machine, install Chromium:**

```bash
cd /path/to/your/repo
uv run .claude/skills/gospelo-md2html/scripts/md2html.py setup
```

## Verify

### Claude Code

Open a session in the project and ask:

```
Convert docs/architecture.md to an A4 PDF
```

Claude Code discovers the skill from `.claude/skills/`, runs a dry-run import first, shows you the page count and warnings, then imports, builds, and screenshots the result. Restart the session if the skill was installed while a session was open.

### GitHub Copilot

Copilot (CLI, VS Code agent mode, cloud agent) scans both `.claude/skills/` and `.agents/skills/`:

```bash
cd /path/to/your/repo
copilot -p "List the names of the agent skills available in this session."
```

`gospelo-md2html` should appear.

### OpenAI Codex

Codex scans `.agents/skills/`, which the installer also populates:

```bash
codex exec "List the names of the agent skills available in this session."
```

### OpenCode

OpenCode scans `.opencode/skills/`, `.claude/skills/` and `.agents/skills/` (project and global), so nothing extra is needed. A `duplicate skill name` warning is expected because the installer writes to two of those paths; both copies are identical. You can also skip the installer and point `opencode.json` at the clone:

```json
{ "skills": { "paths": ["~/src/md2html/skills/claude"] } }
```

## Use

```bash
S=.claude/skills/gospelo-md2html/scripts/md2html.py

# See how the document will paginate (nothing is written)
uv run $S import docs/architecture.md -o out/architecture.json --page a4 --dry-run

# Write the content JSON, then build HTML and PDF
uv run $S import docs/architecture.md -o out/architecture.json --page a4
uv run $S build  out/architecture.json -o out/architecture.html --page a4 --pdf out/architecture.pdf
```

For slides use `--page 16x9` (or `4x3`); the default body size becomes 14pt and each `h2` becomes one slide.

To edit the result, change `out/architecture.json` (one object per page; see the skill's `references/editing_guide.md`), run `check` to see the remaining capacity and planned spills, then `build` again. Rows and items that stop fitting move to a continuation page automatically.

In agent workflows you rarely run these by hand: the agent reads [SKILL.md](../skills/claude/gospelo-md2html/SKILL.md) and follows its steps. See the [README](../README.md) for options, the JSON format, and how pagination works.
