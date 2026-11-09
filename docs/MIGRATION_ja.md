# Gospelo Document 形式への移行

gospelo-md2html 0.2.0 以降、ツールが読み書きするファイルは **Gospelo Document** だけである。`.gospelo.html` (または分離 JSON の `.gospelo.json`) で、最初の `<script>` にエンベロープ `{"format": "gospelo-document", "version": 1, ...}` を持つ。それより前のリリースが書いたファイルは読まない。`check`、`build`、`restore` は次のエラーで止まる。

```
error: old.html: no <script id="gospelo-document"> envelope found; it was written by an earlier md2html release; convert it first: https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION.md
```

`format` を持たない素のコンテンツ JSON (`{"version": 1, "meta": ..., "pages": ...}`) も同様である。

## 原則

Gospelo Document は常に Markdown から生成する。ツールがこれまでに書いたすべてのファイルは取り込んだ Markdown を内部に保持しているので、移行は「Markdown を取り出して `import` し直す」だけである。

## 手順

1. 元の Markdown を用意する。
   - 取り込んだ `.md` が残っていればそれを使う。手順 2 へ。
   - 無ければ移行ツールで旧ファイルから取り出す (標準ライブラリのみ、`uv` 不要)。

     ```bash
     python skills/claude/gospelo-md2html/scripts/extract_markdown.py old.html -o original.md
     ```

     ツールが書いたどのコンテナも読める: `.gospelo.html`、`.gospelo.json`、0.2 より前の HTML (`<script type="text/markdown" id="page-0">` ブロック)、0.2 より前のコンテンツ JSON (`pages[0]` のソースページ)。出力は取り込み時点の Markdown そのものである。

2. 以前と同じ用紙と文字サイズで Gospelo Document を生成する (どちらもページ割りの入力)。

   ```bash
   S=skills/claude/gospelo-md2html/scripts/md2html.py
   uv run $S setup      # 初回のみ: npm パッケージと chrome-headless-shell (Node.js 22.12 以上が必要)
   uv run $S import original.md -o new.gospelo.html --page 16x9 --font-size 14pt
   ```

   旧 HTML の `<script id="md2html-layout">` ブロックを見れば、当時有効だったオプションが分かる。

3. 取り込み後に旧コンテンツ JSON へ加えた編集があれば、それを再適用する。JSON への編集は Markdown には含まれないので、旧 JSON の `pages` と新しい文書のエンベロープを比べ、新しい `.gospelo.html` を編集する (スキルの `references/editing_guide.md` を参照)。

## 何が変わったか

| 0.2.0 より前 | Gospelo Document |
| --- | --- |
| `import` が `content.json` を書き、`build` が HTML を作る | `import` が `<name>.gospelo.html` を直接書く。分離 JSON の `.gospelo.json` は任意 (`-o name.gospelo.json`) |
| Mermaid ライブラリの後ろに 3 ブロック: `page-0` (Markdown)、`md2html-content`、`md2html-layout` | `<head>` 先頭にエンベロープ 1 ブロック `gospelo-document`。Markdown は `pages[0]` |
| 形式識別子なし | エンベロープに `format`、`version`、`generator`。2 行目に `<!-- gospelo-document 1 -->`、`<html>` に `data-gospelo-document` |
| Mermaid ライブラリが `<head>` | スクリプトは `<body>` 末尾 (0.7.0 から図は SVG)。ツールはファイルの先頭だけを読む |
| 拡張子 `.html` | `.gospelo.html` (エンベロープを含んでいれば素の `.html` も入力にできる) |

ページとブロックのモデルは変わっていない。Markdown、用紙、レイアウトオプション、編集規則は同じである。形式は [spec/gospelo-document_ja.md](./spec/gospelo-document_ja.md)、ファイル配置は [ARCHITECTURE_ja.md](./ARCHITECTURE_ja.md) を参照。

## Python 版 (0.2 〜 0.6) から 0.7.0 へ

0.7.0 は Node.js 上の TypeScript で書き直した版である。ファイル形式は変わらない (`format` は `gospelo-document`、`version` は 1) ので、0.2 〜 0.6 が書いた `.gospelo.html` と `.gospelo.json` はそのまま読める。変わるのは図の描き方で、それによって改ページが動きうるため、黙って作り直すことはしない。

| 旧ファイルに記録された値 | `check` / `build` の動き | 変更を受け入れるには |
| --- | --- | --- |
| `layout.mermaidVersion` が `11.12.2` (Python 版はすべてこれ) | 止まる。図は mermaid-arch が Mermaid 12.3.0 で描くようになり、図の大きさ、したがってページが変わりうる | `build old.gospelo.html --mermaid-version 12.3.0` |
| `layout.mermaidLib` が `embed` か `link` | 止まる。図は常に SVG として書き、Mermaid ライブラリはもう同梱しない | `--mermaid-lib prerender` を付ける |

結果は渡す前に確認すること。Mermaid 12 は、図に指定が無ければフローチャートを ELK で配置する。以前の並びを保ちたいフローチャートには、front matter に `layout: dagre` (`---` / `config:` / `layout: dagre` / `---`) を書くか、`%%{init: {"layout": "dagre"}}%%` を書く。はみ出しを送るだけでなく全体を割り付け直すなら `--reflow` を付ける。

その他の違い:

- 準備: Node.js 22.12 以上が必要。`uv run <skill>/scripts/md2html.py setup` が npm パッケージと chrome-headless-shell を入れる (Playwright の Chromium の代わり)。`scripts/md2html.py` のサブコマンドとオプションは同じ。ただし `setup --elk` / `--elk-only` はなくなった。`setup` が npm から入れる Mermaid 12 が ELK を含むので、ELK のバンドルを別に作る必要がない。`layout: elk` (ほかの ELK の名前も) を指定した図はそのまま描ける。知らない layout の名前は、今までどおり dagre で描かずにエラーで止まる。
- AWS アイコンを使う図に対応した (`--icons-zip <path to Icon-package_*.zip>`)。
- ページをまたいで分けた段落の中のリンクが URL を保つようになった。Python 版は `[text]()` と書いていた。エンベロープにすでに空のリンクが入っている文書は、作り直しても URL は戻らない。エンベロープの本文を直すか、Markdown から import し直す。
- 図のラベルの `fa:` アイコンには、Font Awesome Free を全スタイル埋め込む (約 0.2 MB から約 0.5 MB)。
- エンベロープに書く `generator` は `gospelo-md2html 0.7.0`。
