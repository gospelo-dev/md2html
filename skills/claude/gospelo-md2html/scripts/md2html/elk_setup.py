"""`setup --elk`: build the Mermaid ELK layout bundle on the user's machine.

The repository does not carry elkjs (EPL-2.0). It carries the recipe in
references/vendor/mermaid-layout-elk/build/ (entry.mjs, package.json with
pinned versions). This copies the recipe to a temporary directory, installs
the npm packages there (install scripts disabled), bundles them with esbuild
into one IIFE, writes LICENSE.txt from the installed packages, checks the
version, and moves both into assets.ELK_DIR/<version>/. This is the only step
that uses the network; rendering never does.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import assets

# (package directory under node_modules, license file, source URL). The
# packages whose code ends up in the bundle: layout-elk, elkjs, and the d3
# modules behind the one d3 import of layout-elk (curveLinear).
_LICENSED = [
    ("@mermaid-js/layout-elk", "LICENSE", "https://github.com/mermaid-js/mermaid"),
    ("elkjs", "LICENSE.md", "https://github.com/kieler/elkjs (source code is available there)"),
    ("d3-shape", "LICENSE", "https://github.com/d3/d3-shape"),
    ("d3-path", "LICENSE", "https://github.com/d3/d3-path"),
]


class ElkSetupError(RuntimeError):
    pass


def _run(cmd: list[str], cwd: Path) -> None:
    print("  $ " + " ".join(cmd))
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        raise ElkSetupError(f"command failed ({result.returncode}): {' '.join(cmd)}")


def _license_text(node_modules: Path, esbuild_version: str) -> str:
    out = [
        f"mermaid-layout-elk.min.js bundles the following packages, unmodified, with esbuild {esbuild_version}",
        "(recipe: references/vendor/mermaid-layout-elk/build/ of gospelo-md2html). Their licenses follow.",
        "",
    ]
    for name, license_file, url in _LICENSED:
        pkg = json.loads((node_modules / name / "package.json").read_text(encoding="utf-8"))
        text = (node_modules / name / license_file).read_text(encoding="utf-8").strip()
        out += ["=" * 72, f"{name} {pkg['version']} | {pkg['license']} | {url}", "=" * 72, "", text, ""]
    return "\n".join(out)


def build_elk(version: str, npm: str = "npm") -> Path:
    """Build layout-elk `version` into assets.ELK_DIR/<version>/ and return that directory."""
    recipe = json.loads((assets.ELK_BUILD_DIR / "package.json").read_text(encoding="utf-8"))
    pinned = recipe["dependencies"]["@mermaid-js/layout-elk"]
    if pinned != version:
        raise ElkSetupError(f"{assets.ELK_BUILD_DIR / 'package.json'} pins layout-elk {pinned}, expected {version}")
    if shutil.which(npm) is None:
        raise ElkSetupError("npm is not on PATH; the ELK layout bundle is built with Node.js and npm")
    target = assets.ELK_DIR / version
    with tempfile.TemporaryDirectory(prefix="md2html-elk-") as tmp:
        work = Path(tmp)
        for name in ("entry.mjs", "package.json"):
            shutil.copyfile(assets.ELK_BUILD_DIR / name, work / name)
        # --legacy-peer-deps: layout-elk names mermaid as a peer; the page already has it
        _run([npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--legacy-peer-deps"], work)
        _run([npm, "run", "build"], work)
        node_modules = work / "node_modules"
        esbuild_version = json.loads((node_modules / "esbuild" / "package.json").read_text(encoding="utf-8"))["version"]
        stage = work / "out"
        stage.mkdir()
        shutil.copyfile(work / "mermaid-layout-elk.min.js", stage / "mermaid-layout-elk.min.js")
        (stage / "LICENSE.txt").write_text(_license_text(node_modules, esbuild_version), encoding="utf-8")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(stage), str(target))
    try:
        assets.elk_script_tag("embed", None, next(m for m, e in assets.MERMAID_LAYOUT_ELK.items() if e == version))
    except assets.AssetError as e:
        raise ElkSetupError(f"the built bundle failed its check: {e}") from e
    return target


def build_all() -> list[Path]:
    """Build every layout-elk version paired with a vendored Mermaid."""
    versions = sorted({assets.MERMAID_LAYOUT_ELK[m] for m in assets.mermaid_versions() if m in assets.MERMAID_LAYOUT_ELK})
    return [build_elk(v) for v in versions]
