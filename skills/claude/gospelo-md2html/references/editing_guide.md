# コンテンツ JSON の編集ガイド (Agent 向け)

編集対象はコンテンツ JSON だけ。HTML と CSS は生成物なので触らない。

## 構造

```
{ "version": 1, "meta": {title, date, source}, "pages": [ page, ... ] }
page  = { "id": "p05", "kind": "cover|content|source", "title": "h2 の文字列 | null",
          "continued": false, "blocks": [ block, ... ] }
```

- `pages[0]` が `kind: source` なら原文 Markdown のバックアップ。編集しない。
- スライド形式では `title` がヘッダーに出る。文書形式では null。
- `continued: true` は前ページと同じ h2 の続き (ヘッダーに「(続き)」が付く)。

## ブロック

| type | 編集するキー | 例 |
| --- | --- | --- |
| paragraph | `text` (インライン Markdown) | `"text": "**太字** と `code` と [link](url)"` |
| heading | `level` (2-4), `text` | |
| list | `ordered`, `items[].text`, `items[].children`, `start` (任意) | 項目を足す: `items` に `{"text": "..."}` を追加 |
| table | `header`, `rows`, `align` (任意), `continued` (任意) | 行を足す: `rows` に配列を 1 つ追加。列数は `header` と同じ |
| code | `lang`, `lines` (1 行 1 要素), `continued` (任意) | |
| image | `src` (Markdown 基準の相対パス), `alt`, `caption` (任意) | サイズは書かない |
| mermaid | `source` | 図の修正はこの文字列を直すだけ |
| quote | `text` | |
| html | `html` | 編集非推奨 |

レイアウトの値 (px、mm、CSS、段の側、帯にするかどうか) は書かない。図をどちらに出すか、
単段に戻すか、ブロックを帯にするかはレイアウト JSON の `overrides` で指定する。

## 手順

1. `check --report report.json` で対象ページの `remainingPx` / `remainingLines` と、表の
   `rowHeightsPx`、リストの `itemHeightsPx` を見る。「行を 1 つ足すと約 42px 増える。残り
   74px なので 1 行は入る」のように判断する。
2. 該当ページの `blocks` だけを編集する。他のページは触らない。
3. `check` を再実行し、`spills` (自動送りの予定) を確認する。内容を削って収めることはしない。
   送りの位置を変えたいときだけ、自分でページを追加して後半のブロックを移す
   (同じ h2 の続きなら `continued: true` と同じ `title`)。
4. `build` する。自動送りが起きると JSON が書き戻される。以降はその JSON を使う。
5. 2 段のページ (横長用紙の既定) では、列数 4 以上の表、コード、横長の図が幅いっぱいの帯に
   なる。段に入れるか帯にするかを変えたいときはレイアウト JSON の `overrides` でそのブロックに
   `span` (1 = 段、2 = 帯) を指定する。図の枠 (`columns: split`) のページに図は 1 枚まで。
   2 枚目以降は続きページへ自動で送られる。

## 表の続き

分割された表は 2 ブロックになり、後片が `continued: true` を持つ。行を足すときは意味的に
正しい方の表に足す。全体を組み直したいときは `build --reflow` (利用者に確認してから)。

## HTML しか手元に無い場合

生成 HTML はコンテンツ JSON とレイアウト設定を埋め込んでいる。

- `<script type="application/json" id="md2html-content">` の中身がコンテンツ JSON。編集するのはここだけ。描画済みの `<section class="page">` 以下は触らない (再生成で上書きされる)。
- `<script type="application/json" id="md2html-layout">` が有効なレイアウト設定。用紙や文字サイズを変えるときはここか CLI オプションで指定する (CLI が優先)。
- JSON 内では `<` が `\u003c` にエスケープされている。書き戻すときも同じエスケープにする (素の `</script` を入れると要素が壊れる)。
- 編集後は `check out.html` で送りの予定を確認し、`build out.html` で同じファイルを再生成する。自動送りの結果は再生成された HTML の JSON に反映される。
- 原文 Markdown は `<script type="text/markdown" id="page-0">` にあり、`restore out.html -o original.md` で取り出せる。
