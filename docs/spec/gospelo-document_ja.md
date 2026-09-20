# Gospelo Document 形式 バージョン 1 (草案)

Gospelo Document は、ページ割りされた文書 (A4、A3、16:9、4:3) の編集可能な全データを 1 つの HTML ファイルの中に持つ形式である。ファイルはどのブラウザでも開け、先頭付近の JSON オブジェクトを書き換えることで編集でき、その JSON だけから `gospelo-md2html` が再生成できる。本書はコンテナ、エンベロープ (JSON オブジェクト)、読み手と書き手が守る規則を定義する。

「〜しなければならない (MUST)」「〜すべきである (SHOULD)」「〜してもよい (MAY)」は RFC 2119 の意味で使う。JSON Schema は同じディレクトリの `gospelo-document.schema.json`。

状態: 草案 1、2026-09-21。現在の `gospelo-md2html` の出力はこの草案と異なる。差分は 9 節にまとめる。

## 1. 形態

glTF と同じく、単体ファイル、分離 JSON、パッケージ (予約) の 3 形態を持つ。

| 形態 | 拡張子 | メディア型 | 内容 |
| --- | --- | --- | --- |
| 単体ファイル | `.gospelo.html` | `text/html` | エンベロープを埋め込んだ HTML コンテナ (3 節)。配布物 |
| 分離 JSON | `.gospelo.json` | `application/json` | エンベロープ単体 (4 節)。HTML の外で編集や差分を取るための任意形態 |
| パッケージ | `.gospelo` | 予約 | 単体ファイルと外部画像を同梱する ZIP 用に予約。バージョン 1 では定義しない |

エンベロープは単体ファイルでも分離 JSON でも同一である。両者の変換は HTML コンテナの付け外しだけで、他には何も変えない。

## 2. 用語

- **エンベロープ**: 形式識別、メタデータ、レイアウト、ページを持つ JSON オブジェクト。
- **ソースページ**: `pages[0]` で `kind: "source"` のページ。原文 Markdown を 1 つの `markdown` ブロックとして持つ。
- **描画済みページ**: HTML 本体の `<section class="page">` 要素。エンベロープから導出されるもので、編集対象のデータではない。
- **読み手**: エンベロープを読み込むソフトウェア。**書き手**: Gospelo Document を生成するソフトウェア。

## 3. コンテナ (単体ファイル)

### 3.1 構造

```html
<!DOCTYPE html>
<!-- gospelo-document 1 -->
<html lang="ja" data-gospelo-document="1">
<head>
<meta charset="UTF-8">
<title>...</title>
<script type="application/json" id="gospelo-document">
{ ...エンベロープ... }
</script>
<style>...</style>
</head>
<body>
<section class="page" data-page-id="p01">...</section>
...
<script>...figures.js...</script>
<script>...ページ番号...</script>
<script>...mermaid.min.js (Mermaid ブロックがある場合)...</script>
</body>
</html>
```

### 3.2 規則

1. ファイルは UTF-8 の妥当な HTML5 でなければならない。
2. 1 行目は `<!DOCTYPE html>`、2 行目はコメント `<!-- gospelo-document 1 -->` でなければならない。拡張子に関係なく先頭 64 バイトで形式を識別できるようにするため。
3. `<html>` 要素は `data-gospelo-document="1"` を持たなければならず、`meta.lang` と同じ `lang` を持つべきである。
4. エンベロープは `<head>` 内に `<script type="application/json" id="gospelo-document">` としてちょうど 1 回、すべての `<style>` と他のすべての `<script>` より前に埋め込まなければならない。読み手はこの開始タグの後の最初の `</script>` で読み込みを打ち切ってよい。
5. エンベロープ内のすべての `<` は `<` と書かなければならない。これにより `</script` の並びはブロック内に現れず、開始タグの後の最初の `</script>` が終端になる。書き手は `>` を `>`、`&` を `&` にもエスケープすべきである。
6. 大きな静的資産 (Mermaid ライブラリ、`figures.js`、ページ番号スクリプト) は `<body>` の末尾、描画済みページの後に置かなければならない。
7. 描画済みページはビルドのたびにエンベロープから再生成しなければならない。読み手は描画済み DOM をソースデータとして扱ってはならない。
8. 各描画済みページは、対応するページの `id` と同じ `data-page-id` を持たなければならない。レポートや編集が両者を参照できるようにするため。
9. 書き手は人が読むための `<script type="text/markdown" id="gospelo-source">` を追加してもよい。これは参考情報であり、正本はエンベロープ内のソースページである。

## 4. エンベロープ

```json
{
  "format": "gospelo-document",
  "version": 1,
  "generator": "gospelo-md2html 0.1.0",
  "meta": { "title": "...", "date": "2026-09-21", "source": "report.md", "lang": "ja" },
  "layout": { "page": "16x9", "fontSize": "14pt", "columns": "two" },
  "pages": [
    { "id": "p00", "kind": "source", "title": null, "continued": false,
      "blocks": [ { "type": "markdown", "text": "# ..." } ] },
    { "id": "p01", "kind": "cover", "title": "...", "continued": false, "blocks": [ ... ] },
    { "id": "p02", "kind": "content", "title": "1. ...", "continued": false, "blocks": [ ... ] }
  ]
}
```

| フィールド | 必須 | 意味 |
| --- | --- | --- |
| `format` | はい | 常に `"gospelo-document"` |
| `version` | はい | 整数のメジャーバージョン。読み手は実装していないバージョンを拒否しなければならない |
| `generator` | いいえ | 書き出したツールとバージョン。参考情報 |
| `meta` | はい | `title` (必須)、`date`、`source` (ファイルからの Markdown の相対パス)、`lang` (BCP 47、既定 `ja`) |
| `layout` | はい | 用紙、本文サイズ、段組と、ページ単位・ブロック単位の `overrides`。`gospelo-md2html` の CLI オプションと同じキー |
| `pages` | はい | 1 ページ 1 オブジェクト。`pages[0]` はソースページでもよい。`cover` または `content` のページが 1 つ以上必要 |
| `extras` | いいえ | 文書、meta、layout、ページの各レベルに置ける自由形式のアプリケーションデータ。読み手は保持しなければならず、依存してはならない |

### 4.1 ページとブロック

ページとブロックは `gospelo-md2html` のコンテンツ JSON と同じである。ページの `kind` は `source`、`cover`、`content`。ブロックの `type` は `heading`、`paragraph`、`list`、`table`、`code`、`image`、`mermaid`、`quote`、`html`、`markdown`、`pagebreak` のいずれか。インライン書式 (太字、インラインコード、リンク) は Markdown 文字列のまま持つ。`markdown` ブロックはソースページにのみ置ける。ページまたは `table` / `code` ブロックの `continued: true` は前の断片の続きであることを示し、`--reflow` は再ページ割りの前にこれらを結合する。

ブロックの `id` はファイル内では任意である。読み手は id の無いブロックに `<ページ id>-b<番号>` を割り当てる。書き手は自分で生成した id を書き出してはならない。

### 4.2 識別子

- ページ id は文書内で一意でなければならない。ビルドが作る続きページは `<id>-2`、`<id>-3` を使う。
- ブロック id は、ある場合は文書内で一意でなければならず、`layout.overrides` のキーになる。

## 5. 読み込み

準拠する読み手は次のとおり動作する。

1. ファイルを開き、チャンク単位で読む。先頭 64 バイトに `gospelo-document` が無ければ、ファイル全体の走査にフォールバックしてよい (9 節の旧形式)。
2. `<script type="application/json" id="gospelo-document">` と、その後の `</script>` を見つけ、間の JSON を解析して読み込みを終える。
3. `format` が `gospelo-document` でない、または `version` が未対応なら拒否する。
4. スキーマで検証する。`extras` の中を除き、未知のキーはエラーとする。

分離 JSON の読み込みは、ファイル全体に手順 3 と 4 を適用する。

## 6. 書き出し

準拠する書き手は次のとおり動作する。

1. エンベロープを作り、自身のレイアウト処理を行い、その結果からページを描画する。
2. 3.1 節の順序でコンテナを書く。エンベロープはスタイルとスクリプトより前。
3. エンベロープは整形して書く (2 スペースのインデント、1 行 1 キー)。編集が行単位の差分になるようにする。`<` は 3.2 節 5 項のとおりエスケープする。
4. `meta.source` は書き出すファイルのディレクトリからの相対パスにする。
5. 実行時専用のデータ (生成したブロック id、配置情報) は埋め込む前に取り除く。

## 7. 編集の契約

- エンベロープがサポートする唯一の編集面である。描画済み DOM を編集しても次のビルドで消える。
- ビルドは `pages` のページ境界から始め、はみ出した分だけを続きページに送る。前のページに詰め戻すことはない。全体の組み直しは明示的な操作 (`--reflow`) である。
- ビルドで送られた内容は同じファイルのエンベロープに書き戻す。エンベロープと描画済みページが食い違うことはない。
- レイアウトは `layout` に置く。コンテンツページは、自身の id をキーにした `layout.overrides` 以外のレイアウトを持たない。

## 8. 資産

- 画像は `src` でファイルからの相対パスを参照するか、`layout.embedImages` が真なら `data:` URI で埋め込む。
- Mermaid ライブラリは `layout.mermaidLib` が `embed` (既定) で、文書に `mermaid` ブロックが 1 つ以上あるときに埋め込む。`link` ではファイルの隣の `mermaid.min.js` を参照する。Mermaid 図はソースのまま保持し、ブラウザで描画する。事前描画はしない。
- フォントは埋め込まない。例外は Mermaid ソースの `fa:` アイコンに必要な Font Awesome のサブセット。

## 9. 現在の gospelo-md2html 出力との差分 (旧形式)

本形式より前に `gospelo-md2html` が書いたファイルは、5 節 手順 1 のフォールバックで読める。

| 旧形式 | バージョン 1 |
| --- | --- |
| 3 ブロック: `text/markdown` の id `page-0`、JSON の id `md2html-content`、JSON の id `md2html-layout` | エンベロープ 1 ブロック、id `gospelo-document`。Markdown は `pages[0]` に入る。`text/markdown` ブロックは任意の参考情報 |
| ブロックは Mermaid ライブラリ (`<head>` 内) の後、`<body>` の先頭 | エンベロープは `<head>` の先頭、Mermaid ライブラリは `<body>` の末尾 |
| 形式識別子なし。コンテンツ JSON に `version: 1` | エンベロープに `format`、`version`、`generator`。`<html>` に `data-gospelo-document`。2 行目に署名コメント |
| `meta` は `title`、`date`、`source` | 任意の `lang` を追加。文書、meta、layout、ページに `extras` |
| レイアウトの `columns` と `fontSize` は既定時 `null` | 同じ。`null` は「用紙の既定値を使う」 |
| 拡張子 `.html` | `.gospelo.html` (単体)、`.gospelo.json` (分離)。素の `.html` も読める |

読み手は移行期間として旧 id (`page-0`、`md2html-content`、`md2html-layout`) を別名として受け付けるべきであり、書き手はバージョン 1 の形だけを書き出さなければならない。

## 10. 準拠チェックリスト

- [ ] 2 行目が `<!-- gospelo-document 1 -->`
- [ ] `<html data-gospelo-document="1" lang="...">`
- [ ] `#gospelo-document` スクリプトが `<head>` 内にちょうど 1 つ、スタイルとスクリプトより前
- [ ] エンベロープが `gospelo-document.schema.json` を通る
- [ ] エンベロープ内の `<` が `<`
- [ ] 描画済み `section.page` の id が `pages[].id` と一致
- [ ] 大きなスクリプトが `<body>` 末尾
- [ ] `meta.source` がファイルからの相対パス
