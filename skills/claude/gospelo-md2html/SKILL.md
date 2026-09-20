---
name: gospelo-md2html
description: >
  Turn Markdown + Mermaid into layout-aware, paginated HTML slide decks
  (16:9, 4:3) and documents (A4 / A3, portrait or landscape) plus PDF, with a
  chosen body font size. Content lives in an editable content JSON (one object
  per page) that is also embedded in the HTML, so a generated HTML can be
  edited and rebuilt on its own; the original Markdown is preserved inside.
  Use this skill when the user says "md2html", "markdown to html", "markdown to
  pdf", "A4 で出力", "スライドにする", "16:9", "4:3", "印刷用", "ページ区切り",
  "文字サイズを指定して HTML", or wants to edit a page of a generated document.
---

# gospelo-md2html

Markdown を取り込んでページ割り済みの「コンテンツ JSON」にし、JSON を編集して
HTML / PDF を出す。Mermaid は HTML に同梱した Mermaid.js がブラウザで描画する。
ページ割りは Playwright (Chromium) で実測する。

レイアウトの要約は `references/` にある。設計の根拠 (判断事項、ページ割りアルゴリズムの詳細)
はリポジトリ `gospelo-dev/md2html` のメンテナ用 `development/docs/` にあり、スキル本体には含めない。

## 前提

- `uv` が必要。Python パッケージは `scripts/md2html.py` 先頭の PEP 723 宣言から
  uv が解決するので、pip や venv は使わない。
- 初回だけ Chromium を入れる:

```bash
uv run <skill>/scripts/md2html.py setup
```

## 手順 (Agent が守ること)

1. `import --dry-run` でページ数と警告を確認し、利用者に見せる。
2. `import` でコンテンツ JSON を書く。以降の編集対象はこの JSON だけ。
3. 内容を直すときは JSON の該当ページの `blocks` だけを編集する
   (`references/editing_guide.md`)。描画された HTML / CSS は編集しない。
   生成 HTML しか手元に無い場合は、HTML 内の
   `<script type="application/json" id="md2html-content">` の JSON だけを編集し、
   その HTML を `check` / `build` の入力にする (`build out.html` で同じファイルを再生成)。
   レイアウト設定も HTML に埋め込まれているので、オプションの再指定は不要。
4. 編集後は `check --report` で残り容量と自動送り (`spills`) を確認する。
   内容を削ってページに収めることはしない。
5. `build` で HTML (と `--pdf`) を出す。はみ出しは同じタイトルの続きページへ自動で
   送られ、JSON に書き戻される。次の編集は書き戻された JSON に対して行う。
6. 生成した HTML を Playwright / puppeteer でスクリーンショットし、はみ出しや
   図の過小縮小がないことを見てから完了を報告する。レポートの警告は必ず伝える。
7. `--reflow` (ページ割り全体のやり直し) と `import --force` (JSON の編集を捨てる)
   は利用者の指示があるときだけ使う。
8. ページ 0 (原文 Markdown のバックアップ) は編集しない。巻き戻しは
   `restore` で原文を取り出してから `import --force`。

## コマンド

```bash
S=<skill>/scripts/md2html.py
uv run $S import  INPUT.md -o content.json --page 16x9 --font-size 14pt [--dry-run] [--force]
uv run $S check   content.json --page 16x9 --font-size 14pt --report report.json
uv run $S build   content.json -o out.html --page 16x9 --font-size 14pt [--pdf out.pdf] [--reflow] [--no-write-back]
uv run $S check   out.html                       # HTML を入力に (埋め込みの JSON とレイアウトを使う)
uv run $S build   out.html [--pdf out.pdf]        # HTML を同じ場所に再生成
uv run $S restore content.json|out.html -o original.md
```

用紙: `a4` (既定) / `a4-landscape` / `a3` / `a3-landscape` / `16x9` / `4x3`。
文字サイズの既定は A4 11pt、A3 12pt、スライド 14pt。用紙と文字サイズは `import`
にも渡す (ページ割りに使う)。`build` で変えるときは `--reflow`。

段組 (`--columns`): 横長の用紙は既定で 2 段 (`two`: 左段の上から下へ、次に右段へ流す
N 順。列数 4 以上の表、コード、横長の図は幅いっぱいの帯)、縦長は単段 (`single`)。
`split` は図 1 枚をテキストの隣に置く形式。ページやブロック単位の変更はレイアウト JSON の
`overrides` (`columns`、`span`)。

レイアウトの詳細は `references/page_formats.md`、ページ区切りの規則は
`references/layout_rules.md`、JSON の形は `references/content.schema.json` と
`references/layout.schema.json`。

## 警告への対処

| 警告 | 対処 |
| --- | --- |
| figure scaled to < 0.5 | 図が段に対して大きすぎる。2 段ではそのブロックを `overrides` で `span: 2` (帯) にするか、Mermaid の `direction` を変えるか、図を分ける。`split` ならそのページを `columns: single` にする |
| header title truncated | h2 が長い。h2 を短くするか `--header-title fixed:<text>` |
| block ... taller than a page | 1 ブロックがページに入らない (表の 1 行が巨大など)。内容の構造を見直す提案をする |
| droppedDetails | `<details>` を捨てた。本文として必要なら `--details expand` |
| verification did not converge (終了コード 2) | 3 回送っても収まらない。レポートのページを利用者に示す |

## 終了コード

0 = 成功 (自動送りが起きても 0)、1 = 入力や依存関係のエラー、2 = 検証が収束しない。
