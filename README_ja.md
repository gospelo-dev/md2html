# gospelo-md2html

[![License: MIT](https://img.shields.io/badge/License-MIT-1E90FF.svg?style=flat)](https://github.com/gospelo-dev/md2html/blob/main/LICENSE) [![Python](https://img.shields.io/badge/Python-3.10+-1E90FF.svg?style=flat&logo=python&logoColor=white)](https://www.python.org/) [![uv](https://img.shields.io/badge/run_with-uv-DE5FE9.svg?style=flat)](https://docs.astral.sh/uv/) [![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33.svg?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/python/) [![Mermaid](https://img.shields.io/badge/Mermaid-11-FF3670.svg?style=flat&logo=mermaid&logoColor=white)](https://mermaid.js.org/) [![Agent Skill](https://img.shields.io/badge/Agent_Skill-Claude_Code,_Copilot,_Codex,_OpenCode-7B3FF2.svg?style=flat)](https://docs.claude.com/en/docs/claude-code/skills)

<p align="center"><img src="https://github.com/gospelo-dev/md2html/blob/main/assets/hero.jpg?raw=true" alt="gospelo-md2html: Markdown + Mermaid からページ分割されたスライドと文書へ。編集可能な JSON、原文を保持" width="820"></p>

Markdown + Mermaid から、**レイアウトを考慮してページ分割された HTML のスライド資料や文書** を作ります。生成した HTML は **AI エージェントがそのまま編集して再生成でき**、**原文の Markdown を内部に保持** しています。単なる Markdown から HTML への変換ではありません。

English version: [README.md](https://github.com/gospelo-dev/md2html/blob/main/README.md)

一般的な Markdown から PDF への変換は、ブラウザの印刷エンジンに文章を流し込むだけです。見出しがページ末尾に取り残され、表が任意の位置で切れ、図は縮みすぎるかはみ出し、HTML ができた後は 1 ページだけを直すこともできません。このスキルは次の 3 点を軸にしています。

1. **レイアウトを考慮したページ分割。** `import` が全ブロックをヘッドレス Chromium で描画して実寸の高さを取り、組版の規則 (見出しは本文と同じページに、表は行境界で分割してヘッダーを繰り返す、横長の用紙では 2 段に流す) で 16:9 / 4:3 のスライドや A4 / A3 の文書に割り付けます。
2. **AI で編集できる。** 出力は `.gospelo.html` 1 ファイル (**Gospelo Document**) で、その先頭に内容が JSON として置かれます: 1 ページ 1 オブジェクト、本文はインライン Markdown、表は `header` + `rows`、Mermaid はソース文字列。エージェントは該当ページを直して同じファイルに `build` するだけです。収まらなくなった分は同じタイトルの続きページへ自動で送られ、JSON と描画済みページは常に一致します。
3. **原文を保持する。** 取り込み時点の Markdown をファイルの中にそのまま保持し、`restore` でいつでも取り出せます。編集をやり直したいときは原文から `import` し直せます。

レイアウトはコンテンツに含めません。用紙、余白、文字階層、段の分割、図の側は CLI オプションか別のレイアウト JSON で与えます。Mermaid は HTML に同梱した Mermaid.js がブラウザで描画するので、最終ファイルまで図が編集可能なままです。

はじめての方は [クイックスタート](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART_ja.md) ([English](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART.md)) を参照してください。組版の規則とその根拠は [docs/DESIGN_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/DESIGN_ja.md)、1 ファイル構成の設計は [docs/ARCHITECTURE_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/ARCHITECTURE_ja.md)、ファイル形式は [docs/spec/gospelo-document_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/spec/gospelo-document_ja.md) にあります。

## できること

| 機能 | 内容 |
| --- | --- |
| 用紙 | `a4`、`a4-landscape`、`a3`、`a3-landscape` (文書) と `16x9`、`4x3` (スライド) |
| 文字サイズ 1 つで組版 | 見出し、表、コード、余白、フッターの大きさは全て `--font-size` から導出 |
| スライド | h2 ごとに 1 枚。見出しはヘッダー帯に本文の 1.25 倍で表示し、続きスライドに「(続き)」を付ける |
| 2 段組 | 横長の用紙ではブロックを左段の上から下へ、次に右段へ流す (N 順)。列数の多い表、コード、横長の図は幅いっぱいの帯になる。縦長の用紙は単段。図 1 枚をテキストの隣に置く `split` も選べる |
| 実測 | 高さは Chromium (Playwright) で実測し、推定しない。検証パスが全ページのはみ出しを確認する |
| 編集可能なコンテンツ | ページ単位の JSON。表の行、リスト項目、Mermaid ソースは素のデータ |
| 自動送り | 編集で収まらなくなった分は「(続き)」ページへ移す。内容を削ったり押し込んだりしない |
| Gospelo Document | `.gospelo.html` 1 ファイルが内容、レイアウト、原文 Markdown をファイル先頭のエンベロープに持ち、`check` / `build` / `restore` はそのファイルだけで動く。編集者 (やエージェント) に渡すのは 1 ファイルで済む。同じエンベロープを分離 JSON (`.gospelo.json`) として書くこともできる |
| 原文の保持 | 取り込み時点の Markdown をエンベロープのページ 0 にそのまま保持し、`restore` で取り出せる |
| レポート | ページごとの使用量と残り、表の行やリスト項目の高さ、図の縮小率、警告、送りの予定 |

## 前提

対応プラットフォーム: **macOS / Linux / WSL2**

| 依存 | 導入 |
| --- | --- |
| [uv](https://docs.astral.sh/uv/) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.10+、markdown-it-py、Playwright | スクリプト先頭のインラインメタデータから `uv run` が自動で解決 (`pip` も venv も不要) |
| Chromium | 初回のみ `uv run <skill>/scripts/md2html.py setup` |

Mermaid.js と Font Awesome Free はスキルに同梱しており、実行時のダウンロードはありません。

## 使い方

```bash
S=skills/claude/gospelo-md2html/scripts/md2html.py

# 0. 初回のみ
uv run $S setup

# 1. Markdown -> out/handover.gospelo.html。16:9 スライド、本文 14pt (まず --dry-run でページ数と警告を確認)
uv run $S import docs/handover.md -o out/handover.gospelo.html --page 16x9 --font-size 14pt --dry-run
uv run $S import docs/handover.md -o out/handover.gospelo.html --page 16x9 --font-size 14pt

# 2. out/handover.gospelo.html 先頭のエンベロープを編集 (例: p05 の表に行を追加) し、送りの予定を確認
uv run $S check out/handover.gospelo.html --report out/report.json

# 3. 同じファイルを再生成 (PDF も)。はみ出しは続きページへ送られ、ファイルに書き戻される
uv run $S build out/handover.gospelo.html --pdf out/handover.pdf

# いつでも原文 Markdown に戻せる
uv run $S restore out/handover.gospelo.html -o out/handover.original.md

# 編集や差分に別ファイルの JSON を使いたい場合: 分離 JSON を書き、そこから build する
uv run $S import docs/handover.md -o out/handover.gospelo.json --page 16x9 --font-size 14pt
uv run $S build out/handover.gospelo.json --pdf out/handover.pdf     # out/handover.gospelo.html を書く
```

用紙と文字サイズはページ割りの入力なので `import` に渡します。値はファイルに記録されるので、後から変える場合は `build --reflow --page a4` のように指定してページ割り全体をやり直します。

### エンベロープ

`.gospelo.html` の最初の `<script>` (と `.gospelo.json` の全体) がエンベロープです: `format`、`version`、`generator`、`meta`、`layout`、`pages`。`pages[0]` は原文 Markdown、それ以外のページは 1 ページ 1 オブジェクトです。16:9 のコンテンツページ 1 つ分:

```json
{
  "id": "p05",
  "kind": "content",
  "title": "4. 環境とゲートの対応",
  "continued": false,
  "blocks": [
    { "type": "mermaid", "source": "flowchart LR\n  Feat[feature/*] --> Rel[release/*] --> Main[main]" },
    { "type": "heading", "level": 3, "text": "ゲート" },
    {
      "type": "table",
      "header": ["ゲート", "適用先", "内容"],
      "rows": [
        ["層 1", "`release/*`、`main` への PR", "CI が全通過"],
        ["層 2", "`release/*` -> `main`", "stg で E2E 全件通過"]
      ]
    }
  ]
}
```

ゲートを 1 つ足すには `rows` に配列を 1 つ追加するだけです。セルの文字列はインライン Markdown (`**太字**`、`` `code` ``、`[link](url)`) をそのまま持ちます。ブロック型は `heading`、`paragraph`、`list`、`table`、`code`、`image`、`mermaid`、`quote`、`html`、`pagebreak`。エンベロープのスキーマは [references/gospelo-document.schema.json](https://github.com/gospelo-dev/md2html/blob/main/skills/claude/gospelo-md2html/references/gospelo-document.schema.json)、形式の仕様は [docs/spec/gospelo-document_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/spec/gospelo-document_ja.md) にあります。0.2.0 より前に書かれたファイルは読めません。[docs/MIGRATION_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION_ja.md) を参照してください。

### レイアウト JSON (任意)

```json
{
  "page": "16x9",
  "fontSize": "14pt",
  "titleScale": 1.25,
  "columns": "two",
  "overrides": {
    "p07": { "columns": "single" },
    "p08-b1": { "span": 2 },
    "p09-b0": { "maxHeightRatio": 0.7 }
  }
}
```

`--layout layout.json` で渡し、CLI オプションが優先されます。`overrides` はページやブロック単位の調整に使います: ページを単段にする、ブロックを幅いっぱいの帯にする (`span: 2`) か段に収める (`span: 1`)、図の高さ上限を変える、など。

### オプション

| オプション | 既定 | 内容 |
| --- | --- | --- |
| `--page` | `a4` | `a4` / `a4-landscape` / `a3` / `a3-landscape` / `16x9` / `4x3` |
| `--font-size` | A4 11pt、A3 12pt、スライド 14pt | 本文サイズ (`pt`、`px`、`mm`)。他の寸法は全てここから導出 |
| `--title-scale` | `1.25` | スライドのヘッダータイトルの本文比 |
| `--header-title` | `section` | `section` (直近の h2)、`doc` (文書の h1)、`fixed:<text>` |
| `--columns` | 横長 `two`、縦長 `single` | `two` (N 順の 2 段。幅いっぱいの帯あり)、`split` (図 1 枚をテキストの隣に)、`single` (単段) |
| `--figure-side` | `right` | `split` で図を置く側 |
| `--split-ratio` | `0.5` | `split` のテキスト段の比率 (0.4 〜 0.6) |
| `--details` | `drop` | `<details>` の扱い。中身が Mermaid ソースなら常に救出する |
| `--mermaid-lib` | `embed` | Mermaid.js を HTML に埋め込む (単一ファイル、約 3MB) か、隣の `mermaid-<version>.min.js` として `link` する |
| `--mermaid-version` | 同梱の最新版 | 描画に使う同梱 Mermaid の版 (`X.Y.Z`)。生成 HTML はページ割りに使った版を記録し、再生成時も同じ版を使う。版の追加方法は `THIRD_PARTY_NOTICES.md` を参照 |
| `--hr-break` | off | スライド形式で `---` を改ページとして扱う |
| `--embed-images` | off | 画像を data URI で埋め込む |
| `--date` | 当日 | フッターの日付。`none` で非表示 |
| `--report PATH` | | 容量レポートを JSON で書く |
| `--reflow` | | `build`: ページ割りをやり直す。`.gospelo.json` 入力なら JSON を書き換えて終了、`.gospelo.html` 入力なら再生成まで行う |
| `--no-write-back` | | `build`: 自動送りを `.gospelo.json` 入力に書き戻さない |

`check` と `build` の入力は `.gospelo.html` か `.gospelo.json` です。ファイルに記録されたレイアウトが既定値になり、`--layout` と CLI オプションはそれを上書きします。`build out.gospelo.html` は同じファイルを再生成し、`build out.gospelo.json` は `out.gospelo.html` を書きます。

終了コード: `0` 成功 (自動送りを含む)、`1` 入力または依存関係のエラー、`2` 検証が収束しない。

## Agent スキルとしてのインストール

このリポジトリは `skills/claude/gospelo-md2html/` に [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills) を同梱しています。オープンな [Agent Skills 標準](https://github.com/agentskills/agentskills) の可搬なコア部分だけを使っているので、**Claude Code、GitHub Copilot、OpenAI Codex、OpenCode** で動作します。

`scripts/install.py` がスキルを各エージェントの探索パス (`.claude/skills/` と `.agents/skills/`) にコピー (またはシンボリックリンク) します。

```bash
git clone https://github.com/gospelo-dev/md2html.git
INSTALL=md2html/skills/claude/gospelo-md2html/scripts/install.py

python $INSTALL --project /path/to/repo      # プロジェクトに
python $INSTALL --user                       # ユーザー全体に
python $INSTALL --user --symlink             # 開発用: このクローンへのシンボリックリンク
python $INSTALL --project /path/to/repo --force
```

その後、マシンごとに 1 回 `uv run .claude/skills/gospelo-md2html/scripts/md2html.py setup` を実行します。

エージェントは [SKILL.md](https://github.com/gospelo-dev/md2html/blob/main/skills/claude/gospelo-md2html/SKILL.md) からスキルを見つけ、「この Markdown を A4 の PDF にして」「この文書をスライドにして」「5 ページ目の表に行を足して」のような指示で起動します。SKILL.md はエージェントに、まずドライラン、編集は JSON だけ、ビルド前に容量確認、完了報告前にスクリーンショット確認、という手順を守らせます。

OpenCode には専用コピーは不要です。[skills/opencode/README.md](https://github.com/gospelo-dev/md2html/blob/main/skills/opencode/README.md) を参照してください。

### ZIP で配布する

```bash
cd md2html/skills/claude
zip -r gospelo-md2html.zip gospelo-md2html -x "*__pycache__*" -x "*.DS_Store"
```

受け取った側は展開して `python gospelo-md2html/scripts/install.py --project /path/to/repo` を実行します。

## ページ割りの仕組み

- 高さは計測パスで得ます。全ブロックを非表示の連続領域にテキスト段の幅 (横長用紙では単段幅でも) で描画し、Chromium からブロック、表の行、リスト項目、行の高さを取ります。
- ページはコンテンツ高さの 98% まで貪欲に詰めます。見出しは直後の数行 (図なら図全体) の分を確保し、ページ末尾に残りません。表は行境界で分割してヘッダーを繰り返し、3 行未満の断片は作りません。コードは 16 行以上のときだけ分割し、段落は実測した行境界で分割して両側のインライン Markdown を再構成します。
- 横長の用紙は N 順の 2 段 (左段を上から下へ、次に右段) で、列数 4 以上の表、コード、横長の図は幅いっぱいの帯になります。左段に入らない図は、空いている右段の先頭に浮動します。
- 検証パスが最終 HTML を開いて各ページを測り直し、はみ出しがあれば送ります。`build` は編集者が決めたページ境界を保ち、内容を前に詰め直すことはせず、続きページへ送るだけです。

これらの規則の根拠となる設計文書 (用紙、レイアウトロジック、コンテンツモデル、判断事項) はメンテナの作業ディレクトリにあり、要約をスキルの `references/` に置いています。

## リポジトリ構成

```
md2html/
├── skills/
│   ├── claude/
│   │   └── gospelo-md2html/
│   │       ├── SKILL.md                 # Agent Skill の定義と手順
│   │       ├── scripts/
│   │       │   ├── md2html.py           # CLI (PEP 723 メタデータ。uv で実行)
│   │       │   ├── md2html/             # blocks, inline, paginate, measure, render, content など
│   │       │   ├── extract_markdown.py  # 移行用: ツールが書いたどのファイルからも Markdown を取り出す
│   │       │   └── install.py           # 探索パスへのインストーラ
│   │       └── references/
│   │           ├── base.css             # ページ枠と組版 (CSS 変数)
│   │           ├── figures.js           # ブラウザ側の Mermaid 描画と図のサイズ決定
│   │           ├── gospelo-document.schema.json  # エンベロープのスキーマ (ファイル形式)
│   │           ├── layout.schema.json   # レイアウト JSON スキーマ (--layout に渡すファイル)
│   │           ├── page_formats.md      # 用紙、余白、既定値
│   │           ├── layout_rules.md      # ページ区切りの規則
│   │           ├── editing_guide.md     # エージェントがエンベロープを編集する手順
│   │           └── vendor/              # Mermaid.js (版別)、Font Awesome Free (THIRD_PARTY_NOTICES.md 参照)
│   └── opencode/README.md
├── tests/                               # pytest (ページ割り規則、スキーマ、インライン分割、取り込み、エンベロープ入出力、移行)
└── docs/                                # QUICKSTART、DESIGN、ARCHITECTURE、MIGRATION (英日)、spec/gospelo-document
```

テストは `uv run --with pytest --with markdown-it-py --with mdit-py-plugins pytest -q tests` で実行します。

## ライセンス

[MIT](https://github.com/gospelo-dev/md2html/blob/main/LICENSE)。同梱アセットについては [THIRD_PARTY_NOTICES.md](https://github.com/gospelo-dev/md2html/blob/main/THIRD_PARTY_NOTICES.md) を参照してください。
