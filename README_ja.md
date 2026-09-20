# gospelo-md2html

[![License: MIT](https://img.shields.io/badge/License-MIT-1E90FF.svg?style=flat)](https://github.com/gospelo-dev/md2html/blob/main/LICENSE) [![Python](https://img.shields.io/badge/Python-3.10+-1E90FF.svg?style=flat&logo=python&logoColor=white)](https://www.python.org/) [![uv](https://img.shields.io/badge/run_with-uv-DE5FE9.svg?style=flat)](https://docs.astral.sh/uv/) [![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33.svg?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/python/) [![Mermaid](https://img.shields.io/badge/Mermaid-11-FF3670.svg?style=flat&logo=mermaid&logoColor=white)](https://mermaid.js.org/) [![Agent Skill](https://img.shields.io/badge/Agent_Skill-Claude_Code,_Copilot,_Codex,_OpenCode-7B3FF2.svg?style=flat)](https://docs.claude.com/en/docs/claude-code/skills)

<p align="center"><img src="https://github.com/gospelo-dev/md2html/blob/main/assets/hero.jpg?raw=true" alt="gospelo-md2html: Markdown + Mermaid からページ分割されたスライドと文書へ。編集可能な JSON、原文を保持" width="820"></p>

Markdown + Mermaid から、**レイアウトを考慮してページ分割されたスライド資料や文書を、自己完結した HTML 1 ファイル、PDF、PPTX として** 作ります。生成した HTML は **AI エージェントがそのまま編集して再生成でき**、**原文の Markdown を内部に保持** しています。名前は HTML ですが、HTML は正本であり、他の形式はそこから生成します。単なる Markdown から HTML への変換ではありません。

English version: [README.md](https://github.com/gospelo-dev/md2html/blob/main/README.md)

一般的な Markdown から PDF への変換は、ブラウザの印刷エンジンに文章を流し込むだけです。見出しがページ末尾に取り残され、表が任意の位置で切れ、図は縮みすぎるかはみ出し、HTML ができた後は 1 ページだけを直すこともできません。このスキルは次の 3 点を軸にしています。

1. **レイアウトを考慮したページ分割。** `import` が全ブロックをヘッドレス Chromium で描画して実寸の高さを取り、組版の規則 (見出しは本文と同じページに、表は行境界で分割してヘッダーを繰り返す、横長の用紙では 2 段に流す) で 16:9 / 4:3 のスライドや A4 / A3 の文書に割り付けます。
2. **AI で編集できる。** 出力は `.gospelo.html` 1 ファイル (**Gospelo Document**) で、その先頭に内容が JSON として置かれます: 1 ページ 1 オブジェクト、本文はインライン Markdown、表は `header` + `rows`、Mermaid はソース文字列。エージェントは該当ページを直して同じファイルに `build` するだけです。収まらなくなった分は同じタイトルの続きページへ自動で送られ、JSON と描画済みページは常に一致します。
3. **原文を保持する。** 取り込み時点の Markdown をファイルの中にそのまま保持し、`restore` でいつでも取り出せます。編集をやり直したいときは原文から `import` し直せます。

レイアウトはコンテンツに含めません。用紙、余白、文字階層、段の分割、図の側は CLI オプションか別のレイアウト JSON で与えます。Mermaid 図はビルド時に描画して SVG としてファイルに書き込み、ソースはエンベロープに残すので、図は編集可能なままでファイルは小さく保てます (3MB のライブラリを同梱しません)。

はじめての方は [クイックスタート](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART_ja.md) ([English](https://github.com/gospelo-dev/md2html/blob/main/docs/QUICKSTART.md)) を参照してください。組版の規則とその根拠は [docs/DESIGN_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/DESIGN_ja.md)、1 ファイル構成の設計は [docs/ARCHITECTURE_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/ARCHITECTURE_ja.md)、ファイル形式は [docs/spec/gospelo-document_ja.md](https://github.com/gospelo-dev/md2html/blob/main/docs/spec/gospelo-document_ja.md) にあります。

## できること

| 機能 | 内容 |
| --- | --- |
| 用紙 | `a4`、`a4-landscape`、`a3`、`a3-landscape` (文書) と `16x9`、`4x3` (スライド) |
| 文字サイズ 1 つで組版 | 見出し、表、コード、余白、フッターの大きさは全て `--font-size` から導出 |
| スライド | h2 ごとに 1 枚。見出しはヘッダー帯に本文の 1.25 倍で表示し、続きスライドに「(続き)」を付ける |
| 2 段組 | 横長の用紙ではブロックを 2 段組 (左段 → 右段) で流す: 左段の上から下へ、次に右段へ。列数の多い表、コード、横長の図は幅いっぱいの帯になる。縦長の用紙は単段。図 1 枚をテキストの隣に置く `split` も選べる |
| 実測 | 高さは Chromium (Playwright) で実測し、推定しない。検証パスが全ページのはみ出しを確認する |
| 編集可能なコンテンツ | ページ単位の JSON。表の行、リスト項目、Mermaid ソースは素のデータ |
| 自動送り | 編集で収まらなくなった分は「(続き)」ページへ移す。内容を削ったり押し込んだりしない |
| Gospelo Document | `.gospelo.html` 1 ファイルが内容、レイアウト、原文 Markdown をファイル先頭のエンベロープに持ち、`check` / `build` / `restore` はそのファイルだけで動く。編集者 (やエージェント) に渡すのは 1 ファイルで済む。同じエンベロープを分離 JSON (`.gospelo.json`) として書くこともできる |
| 原文の保持 | 取り込み時点の Markdown をエンベロープのページ 0 にそのまま保持し、`restore` で取り出せる |
| レポート | ページごとの使用量と残り、表の行やリスト項目の高さ、図の縮小率、警告、送りの予定 |
| PDF と PPTX | `build --pdf` は Chromium で用紙サイズのまま印刷。`build --pptx` は見た目を固定した PowerPoint を書く: 1 ページ 1 枚の画像スライド (同じ Chromium の描画)、見えないリンク領域、任意の透明テキスト層。PowerPoint 上で編集はできない (下の「PPTX 出力」を参照) |

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

# 3. 同じファイルを再生成 (PDF と PPTX も)。はみ出しは続きページへ送られ、ファイルに書き戻される
uv run $S build out/handover.gospelo.html --pdf out/handover.pdf --pptx out/handover.pptx

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
| `--columns` | 横長 `two`、縦長 `single` | `two` (2 段組 (左段 → 右段)。幅いっぱいの帯あり)、`split` (図 1 枚をテキストの隣に)、`single` (単段) |
| `--figure-side` | `right` | `split` で図を置く側 |
| `--split-ratio` | `0.5` | `split` のテキスト段の比率 (0.4 〜 0.6) |
| `--details` | `drop` | `<details>` の扱い。中身が Mermaid ソースなら常に救出する |
| `--mermaid-lib` | `prerender` | `prerender`: 図を SVG として書き込み、ライブラリを同梱しない (図 5 枚のスライドで約 0.3 〜 0.5MB)。`embed`: Mermaid.js を埋め込みブラウザで描画する (約 3MB)。`link`: 隣の `mermaid-<version>.min.js` を参照する |
| `--mermaid-version` | 同梱の最新版 | 描画に使う同梱 Mermaid の版 (`X.Y.Z`)。生成 HTML はページ割りに使った版を記録し、再生成時も同じ版を使う。版の追加方法は `THIRD_PARTY_NOTICES.md` を参照 |
| `--hr-break` | off | スライド形式で `---` を改ページとして扱う |
| `--embed-images` | off | 画像を data URI で埋め込む |
| `--date` | 当日 | フッターの日付。`none` で非表示 |
| `--pptx PATH` | | `build`: PPTX も書く。各ページが用紙サイズの画像スライド 1 枚になり、`<a href>` は見えないクリック領域になる |
| `--pptx-dpi N` | `200` | スライド画像の解像度 |
| `--pptx-image` | `jpg` | スライド画像の形式。`jpg` (小さい) か `png` (鮮明) |
| `--pptx-text` | off | 透明な選択可能テキスト層を重ねる (検索・コピーが可能。ビューアによっては薄い二重表示に見える) |
| `--pptx-no-links` | off | リンク領域を付けない |
| `--report PATH` | | 容量レポートを JSON で書く |
| `--reflow` | | `build`: ページ割りをやり直す。`.gospelo.json` 入力なら JSON を書き換えて終了、`.gospelo.html` 入力なら再生成まで行う |
| `--no-write-back` | | `build`: 自動送りを `.gospelo.json` 入力に書き戻さない |

`check` と `build` の入力は `.gospelo.html` か `.gospelo.json` です。ファイルに記録されたレイアウトが既定値になり、`--layout` と CLI オプションはそれを上書きします。`build out.gospelo.html` は同じファイルを再生成し、`build out.gospelo.json` は `out.gospelo.html` を書きます。

### PPTX 出力: できることとできないこと

`--pptx` は **見た目を固定したスライド** を作ります。各ページはレイアウトを検証したのと同じ Chromium が描いた 1 枚の画像で、どの環境でも HTML や PDF と同じ見た目になります。配布のための形式であり、編集のための形式ではありません。

向いている場面:

- 相手が `.pptx` しか開けない (提出システム、社内ビューア、Teams や SharePoint のプレビュー) が、レイアウトとフォントは崩したくないとき。PowerPoint は無いフォントを置き換えるため、特に日本語は字面や行送りが変わります。画像なら変わりません。
- 最終稿の提案書やデザインカンプを渡すとき、文字を動かされたり体裁を変えられたりしたくないとき。
- PDF ではなくスライドショー (投影とページ送り) が必要なとき。

向いていない場面: 相手が PowerPoint 上で文字、表、図を直したい場合。このスライドには編集できる要素がありません。代わりに `.gospelo.html` を直して `build` し直してください。その他の制約: 既定の 200dpi で 1 スライド約 100 〜 200KB (`--pptx-dpi 150` で半分程度)。スクリーンリーダーや検索には `--pptx-text` の透明テキスト層が無いと何も見えず、その層はビューアによって (Slack のプレビュー、Google スライド) 薄い二重表示に見えることがあります。ハイパーリンクは見えないクリック領域として動きます。

編集可能なネイティブ PPTX (実測したレイアウトからテキストボックスや表を配置する方式) は別モードとして計画中です。必要なブロック構造と実測座標はすでにあります。

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
- 横長の用紙は 2 段組 (左段 → 右段。左段を上から下へ、次に右段) で、列数 4 以上の表、コード、横長の図は幅いっぱいの帯になります。左段に入らない図は、空いている右段の先頭に浮動します。
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

テストは `uv run --with pytest --with markdown-it-py --with mdit-py-plugins --with python-pptx pytest -q tests` で実行します。

## ライセンス

[MIT](https://github.com/gospelo-dev/md2html/blob/main/LICENSE)。同梱アセットについては [THIRD_PARTY_NOTICES.md](https://github.com/gospelo-dev/md2html/blob/main/THIRD_PARTY_NOTICES.md) を参照してください。
