# クイックスタート

gospelo-md2html スキルを **Claude Code**、**GitHub Copilot**、**Codex**、**OpenCode** で数分で使い始める手順です。

English version: [QUICKSTART.md](QUICKSTART.md)

## 前提

対応プラットフォーム: **macOS / Linux / WSL2**

| 依存 | 必須 | 補足 |
| --- | --- | --- |
| uv | はい | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.10+ | はい | 無ければ uv が導入する。スクリプトが自身の依存を宣言している (PEP 723) |
| Chromium | はい | スキルの `setup` サブコマンドが Playwright 経由で 1 回だけ導入する |

`pip install` も virtualenv も不要です。Mermaid.js と Font Awesome は同梱しています。

## インストール

インストーラがスキルを `.claude/skills/` と `.agents/skills/` にコピーします。これで Claude Code、Copilot、Codex、OpenCode の全てが対象になります。

**このリポジトリから:**

```bash
git clone https://github.com/gospelo-dev/md2html.git
python md2html/skills/claude/gospelo-md2html/scripts/install.py --project /path/to/your/repo
```

**ZIP から** (`gospelo-md2html.zip` を受け取った場合):

```bash
unzip gospelo-md2html.zip
python gospelo-md2html/scripts/install.py --project /path/to/your/repo
```

`--project` の代わりに `--user` でマシン全体に、開発中は `--symlink` でクローンへのリンクに、既存を置き換えるには `--force` を使います。

**その後、マシンごとに 1 回 Chromium を導入します:**

```bash
cd /path/to/your/repo
uv run .claude/skills/gospelo-md2html/scripts/md2html.py setup
```

## 動作確認

### Claude Code

プロジェクトでセッションを開き、次のように頼みます。

```
docs/architecture.md を A4 の PDF にして
```

Claude Code が `.claude/skills/` からスキルを見つけ、まずドライランでページ数と警告を示し、その後に取り込み、ビルド、スクリーンショット確認を行います。セッションを開いたままインストールした場合は再起動してください。

### GitHub Copilot

Copilot (CLI、VS Code のエージェントモード、クラウドエージェント) は `.claude/skills/` と `.agents/skills/` の両方を走査します。

```bash
cd /path/to/your/repo
copilot -p "List the names of the agent skills available in this session."
```

`gospelo-md2html` が表示されれば成功です。

### OpenAI Codex

Codex は `.agents/skills/` を走査します (インストーラが配置済み)。

```bash
codex exec "List the names of the agent skills available in this session."
```

### OpenCode

OpenCode は `.opencode/skills/`、`.claude/skills/`、`.agents/skills/` (プロジェクトとグローバル) を走査するので追加設定は不要です。インストーラが 2 か所に書くため `duplicate skill name` の警告が出ますが、同一内容なので問題ありません。インストーラを使わず `opencode.json` でクローンを直接指すこともできます。

```json
{ "skills": { "paths": ["~/src/md2html/skills/claude"] } }
```

## 使う

```bash
S=.claude/skills/gospelo-md2html/scripts/md2html.py

# ページ割りの確認だけ (何も書かない)
uv run $S import docs/architecture.md -o out/architecture.json --page a4 --dry-run

# コンテンツ JSON を書き、HTML と PDF を生成
uv run $S import docs/architecture.md -o out/architecture.json --page a4
uv run $S build  out/architecture.json -o out/architecture.html --page a4 --pdf out/architecture.pdf
```

スライドにするには `--page 16x9` (または `4x3`) を指定します。本文の既定が 14pt になり、`h2` ごとに 1 枚のスライドになります。

結果を直すには `out/architecture.json` (1 ページ 1 オブジェクト。スキルの `references/editing_guide.md` を参照) を編集し、`check` で残り容量と送りの予定を見てから再度 `build` します。収まらなくなった行や項目は続きページへ自動で移ります。

エージェントのワークフローでは手で実行することはほとんどありません。エージェントが [SKILL.md](../skills/claude/gospelo-md2html/SKILL.md) を読んで手順どおりに進めます。オプション、JSON の形式、ページ割りの仕組みは [README_ja](../README_ja.md) を参照してください。
