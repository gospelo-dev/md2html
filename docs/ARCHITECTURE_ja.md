# HTML 1 ファイルのアーキテクチャ

md2html の成果物は **Gospelo Document**、すなわち `.gospelo.html` ファイル 1 つである。読む人に配る配布物、人やエージェントが編集する原稿、ツールが再生成するときの入力が、すべて同じ 1 ファイルになる。本書はこの「1 ファイル」を中心に組んだアーキテクチャを説明する。ファイルの内部配置、`import` / `build` / `check` / `restore` のデータの流れ、編集対象の JSON をファイル先頭に置く理由、ツールが何を読み何を読まないか。

形式そのもの (エンベロープ、コンテナの規則、準拠条件) は `docs/spec/gospelo-document_ja.md` で定義する。本アーキテクチャは gospelo-md2html 0.2.0 で実装済みである。

## 1. 目標

| 目標 | 帰結 |
| --- | --- |
| 配布物は 1 ファイル | 付随する JSON、外部の Mermaid ライブラリ、外部スクリプトを持たない。パス参照の画像だけは、埋め込みを指定しない限り外部に残る |
| ツールが無くても編集できる | 全ページを決めるコンテンツは素の JSON としてファイル内にあり、エディタやエージェントが最初に目にする位置に置く |
| そのファイルだけで再生成できる | `build out.gospelo.html` が埋め込みエンベロープから描画済みページを作り直す。原文 Markdown も内部に保持し `restore` で取り出せる |
| 読み込みが軽い | ツールはファイルの先頭だけを読んでエンベロープを得る。それ以降 (描画済みページ、`embed` のときは数 MB の Mermaid ライブラリ) を Python が解析することはない |
| 差分が読める | エンベロープは整形して埋め込み、描画済みページは 1 ブロック 1 行で出すため、1 段落の変更は数行の差分として版管理に現れる |

## 2. ファイルの配置

人やプログラムが最初に必要とするものを前に、大きくて静的なものを後ろに置く。

```mermaid
flowchart TB
    subgraph Head["1. 先頭 (小さい、編集対象)"]
        direction TB
        SIG["2 行目: コメント gospelo-document 1<br/>html data-gospelo-document=1"]
        ENV["script type=application/json id=gospelo-document<br/>エンベロープ: format, version, generator, meta, layout, pages<br/>(pages[0] = 原文 Markdown)"]
        S["style: BIZ UD フォントのサブセット (約 0.3 MB)、<br/>計算済み変数、base.css"]
        SIG --> ENV --> S
    end
    subgraph Body["2. 本体 (描画済み、build が再生成)"]
        direction TB
        P1["section.page (表紙)"]
        P2["section.page ..."]
        Pn["section.page (n / N)"]
        P1 --> P2 --> Pn
    end
    subgraph Tail["3. 末尾 (大きい、静的)"]
        direction TB
        MJ["mermaid.min.js + MIT 表示 (約 3 MB)<br/>embed / link のときだけ。既定の prerender は SVG を書く"]
        F["figures.js: 画像と Mermaid のサイズ決定"]
        N["ページ番号の振り直しスクリプト"]
        MJ --> F --> N
    end
    Head --> Body --> Tail

    classDef node fill:#FFFFFF,stroke:#666666,stroke-width:1.5px,color:#2C2C2C
    class SIG,ENV,S,P1,P2,Pn,F,N,MJ node
    style Head fill:#F0FDFA,stroke:#0D9488,color:#2C2C2C
    style Body fill:#F8FAFC,stroke:#94A3B8,color:#2C2C2C
    style Tail fill:#F8FAFC,stroke:#94A3B8,color:#2C2C2C
```

| 部分 | 備考 |
| --- | --- |
| 署名 | 2 行目の `<!-- gospelo-document 1 -->` と `<html>` の `data-gospelo-document="1"`。拡張子に関係なく先頭数バイトで形式が分かる |
| エンベロープ 1 ブロック、`<head>` の先頭 | すべての `<style>` と他のすべての `<script>` より前。3.1 MB のスライドでは 282 バイト目から始まり約 37 KB で終わり、読み手が最初に取る 64 KB のチャンクに収まる |
| 原文 Markdown はエンベロープの中 | `pages[0]`、`kind: "source"`。別の Markdown ブロックは持たず、データは 1 か所だけ |
| フォントは `<style>` の中 | 同梱の BIZ UD (OFL) をエンベロープに含まれる文字だけに絞ったサブセットを `@font-face` の data URI で持つ。本文に Regular、見出しと強調に Bold、コードに BIZ UDGothic。計測ページも同じ CSS を使うので、ページ割りはインストール済みフォントに左右されない。`embedFonts: false` で省く |
| 図は SVG (既定の `prerender`) | 検証パスが Chromium で各 Mermaid ブロックを描き、最終ファイルにはその SVG を図の中に書く。ライブラリは同梱しない。ソースはエンベロープに残るので `build` が描き直す |
| Mermaid ライブラリは `<body>` の末尾 (`embed` / `link`) | 直前に MIT 表示のコメント。Mermaid は DOM 構築後に初期化されるので位置は描画に影響しない。その後に `figures.js`、ページ番号スクリプト |
| 描画済みページは build のたびに再生成 | DOM は派生データであり、直接編集は対象外 |

### 2.1 エスケープの規則

- エンベロープ内の `<` `>` `&` は JSON のエスケープ (`\u003c`、`\u003e`、`\u0026`) で書く。ブロック内に `</script` やコメントの並びが現れないので、開始タグの後に最初に出る `</script>` が終端である。
- 原文 Markdown はエンベロープ内の JSON 文字列なので、同じエスケープで守られる。

## 3. データの流れ

### 3.1 コマンド

```mermaid
flowchart LR
    MD["Markdown + Mermaid"]
    H["out.gospelo.html<br/>(1 ファイル)"]
    PDF["out.pdf"]
    ORIG["original.md"]
    MD -->|import| H
    H -->|build| H
    H -->|build --pdf| PDF
    H -->|build --pptx| PPTX["out.pptx"]
    H -->|check| R["レポート (標準出力 / JSON)"]
    H -->|restore| ORIG
    E["エディタやエージェントが<br/>エンベロープを編集"] -.->|編集| H

    classDef node fill:#FFFFFF,stroke:#666666,stroke-width:1.5px,color:#2C2C2C
    class MD,H,PDF,PPTX,ORIG,R,E node
    linkStyle 0,1,2,3,4,5 stroke:#0D9488,stroke-width:2px
    linkStyle 6 stroke:#9CA3AF,stroke-width:1.5px,stroke-dasharray:4 4
```

| コマンド | 入力 | 出力 |
| --- | --- | --- |
| `import` | Markdown | `<name>.gospelo.html` (ページ割りと検証済み)。`-o name.gospelo.json` なら分離 JSON |
| `build` | `.gospelo.html` または `.gospelo.json` | 同じ HTML を上書き (`-o` で別の場所も可。JSON 入力なら `<name>.gospelo.html`)、任意で PDF (`--pdf`) と PPTX (`--pptx`: 同じ Chromium の描画を 1 ページ 1 枚の画像スライドに、リンク領域と任意の透明テキスト層付き) |
| `build --reflow` | 同上 | 全ページを組み直す |
| `check` | 同上 | 容量レポートと送りの予定。何も書かない |
| `restore` | 同上 | `pages[0]` の原文 Markdown |

0.2.0 より前に書かれたファイル (Mermaid ライブラリの後ろに `page-0`、`md2html-content`、`md2html-layout` の 3 ブロックがある HTML、または素のコンテンツ JSON) は読まない。ツールは `docs/MIGRATION.md` (日本語版 `docs/MIGRATION_ja.md`) へのリンク付きのエラーで止まる。`scripts/extract_markdown.py` がそれらのファイルから Markdown を取り出すので、`import` で Gospelo Document を生成し直せる。

### 3.2 import と build の内部

両コマンドは計測、ページ割り、検証の同じパイプラインを共有する。高さは推定せず、ヘッドレス Chromium で描画して測る。

```mermaid
flowchart TB
    subgraph Import["import"]
        direction LR
        I1["Markdown を<br/>ブロック列に"] --> I2["高さを計測<br/>(段幅と全幅)"] --> I3["ページ割り<br/>容量 = 高さ x 0.98"]
    end
    subgraph Common["確定と検証 (import と build で共通)"]
        direction LR
        B1["ページごとに配置<br/>(2 段、帯、図)"] --> B2["HTML を描画"] --> B3["Chromium で開き<br/>はみ出しを検出"]
        B3 -->|はみ出し| B4["末尾ブロックを<br/>続きページへ"] --> B2
        B3 -->|問題なし、最大 3 回| B5["最終ページ列"]
    end
    subgraph Out["出力"]
        direction LR
        O1["先頭にエンベロープ:<br/>Markdown、ページ、実効レイアウト"] --> O2["描画済みページを追加"] --> O3["mermaid.min.js、figures.js、<br/>番号振りを末尾に"]
    end
    Import --> Common --> Out
    H["既存の .gospelo.html"] -->|build: 先頭を読む| Common

    classDef node fill:#FFFFFF,stroke:#666666,stroke-width:1.5px,color:#2C2C2C
    class I1,I2,I3,B1,B2,B3,B4,B5,O1,O2,O3,H node
    style Import fill:#F8FAFC,stroke:#94A3B8,color:#2C2C2C
    style Common fill:#F0FDFA,stroke:#0D9488,color:#2C2C2C
    style Out fill:#F8FAFC,stroke:#94A3B8,color:#2C2C2C
```

`import` も確定と検証のパスを通すので、書き出すファイルは `build` がそこから作るものと同一で、後の `build` は何も動かさない。Mermaid 図は検証パスの中で同梱の Mermaid.js が Chromium 上で描く。既定の `prerender` ではその SVG をファイルに書き込みライブラリは同梱しないが、ソース文字列はエンベロープに残るので図は編集できる (ソースを直して `build`)。`embed` と `link` ではソースをページに置き、ブラウザが描く。エンベロープは使った Mermaid の版を記録し (`layout.mermaidVersion`)、再生成は必ずその版で行う。図の寸法、したがってページ割りが版に依存するためである。

## 4. 先頭だけを読む

エンベロープが先頭にあり、終端が決まっているので、ツールはファイルをストリームとして読み、途中で止める。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'actorBkg': '#FFFFFF', 'actorBorder': '#666666', 'actorTextColor': '#2C2C2C', 'signalColor': '#0D9488', 'signalTextColor': '#2C2C2C', 'noteBkgColor': '#F0FDFA', 'noteBorderColor': '#0D9488', 'noteTextColor': '#2C2C2C', 'activationBkgColor': '#F8FAFC', 'activationBorderColor': '#94A3B8', 'loopTextColor': '#2C2C2C', 'labelBoxBkgColor': '#F0FDFA', 'labelBoxBorderColor': '#0D9488', 'labelTextColor': '#2C2C2C'}}}%%
sequenceDiagram
    participant T as md2html (Python)
    participant F as out.gospelo.html

    T->>F: 開いて 64 KB を 1 チャンク読む
    F-->>T: バイト列
    T->>T: script id=gospelo-document を探す (このチャンク内に必須)
    T->>T: 終端タグを探す (必要なときだけ次のチャンクを読む)
    T-->>T: 読み込みを終了 (ページと Mermaid ライブラリは読まない)
    T->>T: json.loads(エンベロープ)、format と version を検証
    Note over T: 最初のチャンクにエンベロープが無ければ<br/>docs/MIGRATION.md へのリンク付きエラー
```

| 観点 | 備考 |
| --- | --- |
| 早期終了 | `content.read_head` に実装。`embedImages` で画像を埋め込んだときや、数十 MB の長い文書で効き、メモリも先頭分で済む |
| フォールバック無し | 最初のチャンクにエンベロープが無いファイルは拒否する。ファイル全体の走査も、以前のブロック配置の読み手も持たない |
| `build` に必要なのは先頭だけ | Mermaid ライブラリは同梱の vendor 版から取り、ページはエンベロープから再生成する |

## 5. 編集の流れ

サポートする編集経路はエンベロープだけである。描画済み DOM は出力であって入力ではない。

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'actorBkg': '#FFFFFF', 'actorBorder': '#666666', 'actorTextColor': '#2C2C2C', 'signalColor': '#0D9488', 'signalTextColor': '#2C2C2C', 'noteBkgColor': '#F0FDFA', 'noteBorderColor': '#0D9488', 'noteTextColor': '#2C2C2C', 'activationBkgColor': '#F8FAFC', 'activationBorderColor': '#94A3B8', 'loopTextColor': '#2C2C2C', 'labelBoxBkgColor': '#F0FDFA', 'labelBoxBorderColor': '#0D9488', 'labelTextColor': '#2C2C2C'}}}%%
sequenceDiagram
    participant A as エディタ / エージェント
    participant H as out.gospelo.html
    participant T as md2html

    A->>H: 開いてエンベロープのブロックを編集<br/>(本文、表の行、リスト項目)
    A->>T: check out.gospelo.html
    T->>H: 先頭を読む
    T-->>A: 容量レポート、送りの予定
    A->>T: build out.gospelo.html
    T->>H: 先頭を読み、再描画し、Chromium で検証
    T->>H: ファイル全体を書き出す (送りがあればエンベロープも更新)
    T-->>A: wrote out.gospelo.html
```

流れを予測可能にする規則:

- `build` はエンベロープのページ境界を出発点にし、はみ出した分だけを続きページ (`id-2`、`id-3`、`continued: true`) へ送る。前のページに詰め戻すことはしない。全体を組み直すのは `--reflow` だけ。
- 送りの結果は同じファイルのエンベロープに書き戻す。エンベロープとページが食い違うことはない。
- レイアウト (用紙、文字サイズ、段組、Mermaid の版) は `layout` と CLI オプションに置く。コンテンツはページ単位・ブロック単位の `layout.overrides` 以外にレイアウトを持たない。

## 6. 差分と版管理

- エンベロープは整形済み (2 スペースのインデント、1 行 1 キー)。1 段落の編集は数行の差分になる。
- Mermaid ライブラリは固定版なので差分に現れない。
- 描画済みページは 1 ブロック 1 行で出すので、描画部分の差分もブロック単位になる。レビューは引き続きエンベロープ側で行う想定。
- 内容はエンベロープと DOM の 2 か所に現れる。これは設計どおりで、DOM は派生データとして再生成され、この重複があるからこそツールが無くても閲覧できる。

## 7. トレードオフ

| 論点 | トレードオフ | 立場 |
| --- | --- | --- |
| ファイルサイズ | Mermaid.js を同梱すると 1 ファイルあたり約 3 MB 増える | 既定の `prerender` は図を SVG として書き、ライブラリを同梱しない (図 5 枚の 15 ページのスライドで約 0.45 MB。大半は `fa:` アイコン用の Font Awesome フォント)。`embed` (ブラウザ描画、約 3 MB) と `link` (隣の `mermaid-<version>.min.js` を共有) は選択肢として残す |
| 複数の用紙 | 1 つのファイルは 1 つのレイアウトしか持たない。同じ内容を A4 と 16:9 で出すならファイルが 2 つになる | 受け入れる。どちらのファイルからでも `build --page a4 --reflow` で作り直せる。エンベロープの内容は同じ |
| JavaScript が動かないビューア | スクリプトが動かない環境ではページ番号が静的値のままになり、`embed` / `link` では Mermaid がソースのまま表示される | 受け入れる。既定の `prerender` では図は素の SVG なので、スクリプト無しでも表示される |
| 画像 | パス参照の画像は既定で外部に残る | 完全に自己完結させたい場合は `embedImages` を使う |
| 分離 JSON | HTML の外で編集したい場合や差分を小さくしたい場合には有用 | 任意の出力 (`.gospelo.json`、同じエンベロープ)。配布物には含めない |
| 以前の形式 | 読めるようにすると 2 つのコード経路を保守することになる | 読まない。移行は Markdown からの再 `import` で、以前のファイルもすべて Markdown を内部に持っている (`docs/MIGRATION_ja.md`) |

## 8. 所在

| 関心事 | 場所 |
| --- | --- |
| エンベロープのモデル、先頭読み込み、検証 | `scripts/md2html/content.py` |
| コンテナの描画 (先頭、ページ、末尾) | `scripts/md2html/render.py` |
| コマンドと既定のパス | `scripts/md2html.py` |
| 版別の Mermaid 同梱とライセンス表示 | `scripts/md2html/assets.py`、`references/vendor/mermaid/<version>/` |
| エンベロープのスキーマ (スキルに同梱) | `references/gospelo-document.schema.json` |
| 形式の仕様 | `docs/spec/gospelo-document_ja.md` |
| 以前のファイルからの移行 | `docs/MIGRATION_ja.md`、`scripts/extract_markdown.py` |

それ以外 (計測、ページ割りの規則、2 段レイアウト、図のサイズ決定、検証) は `development/docs/`、設計の根拠と引用元は `development/docs/design/` に置く。
