#!/usr/bin/env python3
"""
install.py -- Install this skill into agent skill discovery paths.

Copies (or symlinks) the skill folder so that Claude Code, GitHub Copilot,
OpenAI Codex, and OpenCode can all discover it:

  project scope:  <repo>/.claude/skills/   Claude Code, Copilot, OpenCode
                  <repo>/.agents/skills/   Codex, Copilot, OpenCode
  user scope:     ~/.claude/skills/        Claude Code, OpenCode
                  ~/.agents/skills/        Codex, Copilot, OpenCode

Typical use after receiving the skill as a ZIP:

    unzip gospelo-md2html.zip
    python gospelo-md2html/scripts/install.py --project /path/to/repo

Usage:
    python install.py                      # install into the current directory's project
    python install.py --project <path>    # install into a specific project
    python install.py --user              # install user-wide (all projects)
    python install.py --symlink           # symlink instead of copy (for development)
    python install.py --force             # replace an existing installation

The skill itself runs with uv (scripts/md2html.py carries PEP 723 metadata);
this installer only needs the Python standard library.
"""

import argparse
import os
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_SRC = os.path.dirname(SCRIPT_DIR)
SKILL_NAME = os.path.basename(SKILL_SRC)

IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")

AGENTS_BY_DIR = {
    ".claude": "Claude Code / Copilot / OpenCode",
    ".agents": "Codex / Copilot / OpenCode",
}


def dest_roots(args):
    if args.user:
        base = os.path.expanduser("~")
    else:
        base = os.path.abspath(args.project)
        if not os.path.isdir(base):
            print(f"Error: project directory not found: {base}", file=sys.stderr)
            sys.exit(1)
    return [os.path.join(base, d, "skills") for d in AGENTS_BY_DIR]


def install_into(root, symlink, force):
    dest = os.path.join(root, SKILL_NAME)

    if os.path.realpath(dest) == os.path.realpath(SKILL_SRC) and not force:
        print(f"  SKIP  {dest} (already points at this source)")
        return True

    if os.path.lexists(dest):
        if not force:
            print(f"  SKIP  {dest} (exists; use --force to replace)")
            return False
        if os.path.islink(dest) or os.path.isfile(dest):
            os.unlink(dest)
        else:
            shutil.rmtree(dest)

    os.makedirs(root, exist_ok=True)
    if symlink:
        os.symlink(SKILL_SRC, dest)
        print(f"  LINK  {dest} -> {SKILL_SRC}")
    else:
        shutil.copytree(SKILL_SRC, dest, ignore=IGNORE)
        print(f"  COPY  {dest}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Install this skill into agent skill discovery paths."
    )
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument(
        "--project",
        default=".",
        help="Project (repository) root to install into (default: current directory)",
    )
    scope.add_argument(
        "--user",
        action="store_true",
        help="Install user-wide (~/.claude/skills and ~/.agents/skills)",
    )
    parser.add_argument(
        "--symlink",
        action="store_true",
        help="Symlink to this source instead of copying (for development setups)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing installation",
    )
    args = parser.parse_args()

    print(f"Installing {SKILL_NAME} from {SKILL_SRC}")
    ok = True
    for root in dest_roots(args):
        agents = AGENTS_BY_DIR[os.path.basename(os.path.dirname(root))]
        print(f"[{agents}]")
        ok = install_into(root, args.symlink, args.force) and ok

    if ok:
        print("\nDone. Restart your agent session to pick up the new skill.")
        print("First run only: uv run <skill>/scripts/md2html.py setup   (installs Chromium)")
    else:
        print("\nDone with skips. Re-run with --force to replace existing installs.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
