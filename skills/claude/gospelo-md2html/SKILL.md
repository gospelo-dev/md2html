---
name: gospelo-md2html
description: >
  Turn Markdown + Mermaid into layout-aware, paginated HTML slide decks
  (16:9, 4:3) and documents (A4 / A3, portrait or landscape) plus PDF, with a
  chosen body font size. The output is one self-contained .gospelo.html
  (a Gospelo Document): its content (one JSON object per page) and layout sit
  at the top of the file, so the file can be edited and rebuilt on its own;
  the original Markdown is preserved inside. Use this skill when the user says
  "md2html", "markdown to html", "markdown to pdf", "A4 で出力",
  "スライドにする", "16:9", "4:3", "印刷用", "ページ区切り",
  "文字サイズを指定して HTML", or wants to edit a page of a generated document.
---

# gospelo-md2html

Markdown を取り込み、ページ割り済みの **Gospelo Document** (`<name>.gospelo.html`) を書く。
編集対象はその HTML の先頭にあるエンベロープ JSON (`<script id="gospelo-document">`) だけで、
`check` / `build` はその HTML を入力にして同じファイルを再生成する。Mermaid 図はビルド時に
Chromium で描いて SVG として書き込む (既定の `--mermaid-lib prerender`。ソースはエンベロープに残る)。
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
2. `import` で `<name>.gospelo.html` を書く。以降の編集対象はこのファイルのエンベロープ JSON だけ。
3. 内容を直すときは、エンベロープ JSON の該当ページの `blocks` だけを編集する
   (`references/editing_guide.md`)。描画済みの `<section class="page">` 以下と CSS は編集しない
   (再生成で上書きされる)。レイアウト設定もエンベロープの `layout` にあるので、
   オプションの再指定は不要。
4. 編集後は `check --report` で残り容量と自動送り (`spills`) を確認する。
   内容を削ってページに収めることはしない。
5. `build` で同じ HTML を再生成する (`--pdf` で PDF も)。はみ出しは同じタイトルの続きページへ
   自動で送られ、エンベロープに書き戻される。
6. 生成した HTML を Playwright / puppeteer でスクリーンショットし、はみ出しや
   図の過小縮小がないことを見てから完了を報告する。レポートの警告は必ず伝える。
7. `--reflow` (ページ割り全体のやり直し) と `import --force` (編集を捨てる)
   は利用者の指示があるときだけ使う。
8. ページ 0 (原文 Markdown のバックアップ) は編集しない。巻き戻しは
   `restore` で原文を取り出してから `import --force`。
9. 0.2 より前の md2html が書いた HTML / JSON は読めない (エラーに移行手順の URL が出る)。
   `scripts/extract_markdown.py` で原文を取り出して `import` し直す。

## コマンド

```bash
S=<skill>/scripts/md2html.py
uv run $S import  INPUT.md --page 16x9 --font-size 14pt [--dry-run] [--force]   # INPUT.gospelo.html を書く
uv run $S import  INPUT.md -o out/deck.gospelo.html --page 16x9 --font-size 14pt
uv run $S check   out/deck.gospelo.html --report report.json                      # 何も書かない
uv run $S build   out/deck.gospelo.html [--pdf out/deck.pdf] [--reflow] [--font-size 12pt]   # 同じファイルを再生成
uv run $S restore out/deck.gospelo.html -o original.md
uv run $S import  INPUT.md -o content.gospelo.json --page a4   # 分離 JSON (任意)。build で HTML にする
python <skill>/scripts/extract_markdown.py old.html -o original.md   # 旧形式からの移行
```

用紙: `a4` (既定) / `a4-landscape` / `a3` / `a3-landscape` / `16x9` / `4x3`。
文字サイズの既定は A4 11pt、A3 12pt、スライド 14pt。用紙と文字サイズは `import`
に渡す (ページ割りに使う)。`build` で変えるときは `--reflow`。

段組 (`--columns`): 横長の用紙は既定で 2 段組 (`two`: 左段 → 右段。左段の上から下へ、次に右段へ
流す。列数 4 以上の表、コード、横長の図は幅いっぱいの帯)、縦長は単段 (`single`)。
`split` は図 1 枚をテキストの隣に置く形式。ページやブロック単位の変更はレイアウトの
`overrides` (`columns`、`span`)。

レイアウトの詳細は `references/page_formats.md`、ページ区切りの規則は
`references/layout_rules.md`、ファイル形式は `references/gospelo-document.schema.json`
(エンベロープ) と `references/layout.schema.json` (`--layout` に渡すレイアウト JSON)。

## 警告への対処

| 警告 | 対処 |
| --- | --- |
| figure scaled to < 0.5 | 図が段に対して大きすぎる。2 段ではそのブロックを `overrides` で `span: 2` (帯) にするか、Mermaid の `direction` を変えるか、図を分ける。`split` ならそのページを `columns: single` にする |
| header title truncated | h2 が長い。h2 を短くするか `--header-title fixed:<text>` |
| block ... taller than a page | 1 ブロックがページに入らない (表の 1 行が巨大など)。内容の構造を見直す提案をする |
| droppedDetails | `<details>` を捨てた。本文として必要なら `--details expand` |
| verification did not converge (終了コード 2) | 3 回送っても収まらない。レポートのページを利用者に示す |
| no gospelo-document envelope found | 0.2 より前の出力。`extract_markdown.py` で原文を取り出して `import` し直す |

## 終了コード

0 = 成功 (自動送りが起きても 0)、1 = 入力や依存関係のエラー、2 = 検証が収束しない。
