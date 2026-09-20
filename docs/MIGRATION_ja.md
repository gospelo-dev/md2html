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
| Mermaid ライブラリが `<head>` | Mermaid ライブラリとスクリプトは `<body>` 末尾。ツールはファイルの先頭だけを読む |
| 拡張子 `.html` | `.gospelo.html` (エンベロープを含んでいれば素の `.html` も入力にできる) |

ページとブロックのモデルは変わっていない。Markdown、用紙、レイアウトオプション、編集規則は同じである。形式は `docs/spec/gospelo-document_ja.md`、ファイル配置は `docs/ARCHITECTURE_ja.md` を参照。
