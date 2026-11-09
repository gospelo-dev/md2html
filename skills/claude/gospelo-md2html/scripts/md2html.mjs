#!/usr/bin/env node

// src/cli.ts
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync6, statSync as statSync3, unlinkSync, writeFileSync as writeFileSync5 } from "node:fs";
import { basename as basename3, dirname as dirname4, extname as extname3, join as join4, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";
import { parseArgs } from "node:util";
import { BuildError as BuildError2, puppeteerCacheDir, resolveChrome, SHELL_VERSION } from "@gospelo/mermaid-arch";

// src/assets.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontAwesome, installedMermaid } from "@gospelo/mermaid-arch";
var SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
var REFERENCES = join(SKILL_DIR, "references");
var VENDOR = join(REFERENCES, "vendor");
var SHIKI_DIR = join(VENDOR, "shiki");
var BASE_CSS = join(REFERENCES, "base.css");
var FIGURES_JS = join(REFERENCES, "figures.js");
var VERSION_RE = /^\d+\.\d+\.\d+$/;
var AssetError = class extends Error {
};
function read(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new AssetError(`required asset is missing: ${path}`);
  return readFileSync(path, "utf-8");
}
function baseCss() {
  return read(BASE_CSS);
}
function figuresJs() {
  return read(FIGURES_JS);
}
function versionKey(v) {
  return v.split(".").map((x2) => parseInt(x2, 10));
}
function compareVersions(a, b) {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
function mermaidVersion() {
  return installedMermaid().version;
}
function shikiVersions() {
  if (!existsSync(SHIKI_DIR)) return [];
  return readdirSync(SHIKI_DIR).filter((name) => VERSION_RE.test(name) && existsSync(join(SHIKI_DIR, name, "shiki.min.js"))).sort(compareVersions);
}
function shikiScriptTag() {
  const versions = shikiVersions();
  const version = versions[versions.length - 1];
  if (version === void 0) return "";
  const text = read(join(SHIKI_DIR, version, "shiki.min.js"));
  return `<script data-shiki-version="${version}">
${text}
</script>`;
}
function fontawesomeStyleTag() {
  return "<style>\n" + fontAwesome().css + "\n</style>";
}
function pageNumberScript() {
  return "<script>\ndocument.addEventListener('DOMContentLoaded', function () {\n  var pages = document.querySelectorAll('.page');\n  pages.forEach(function (p, i) {\n    var el = p.querySelector('.page-number');\n    if (el) { el.textContent = (i + 1) + ' / ' + pages.length; }\n  });\n});\n</script>";
}

// src/markdown.ts
import MarkdownIt from "markdown-it";
var md = new MarkdownIt("commonmark", { html: true, linkify: false, typographer: false });
md.enable(["table", "strikethrough"]);
function inlineTokens(text) {
  const top = md.parseInline(text, {});
  return top[0]?.children ?? [];
}

// src/py.ts
function fixed(x2, digits) {
  const s = x2.toFixed(digits);
  return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}
function pyFloat(x2) {
  if (Number.isInteger(x2) && Math.abs(x2) < 1e16) return `${x2}.0`;
  return String(x2);
}
function pyRound(x2, n = 0) {
  const m = 10 ** n;
  const y = x2 * m;
  const r = Math.round(y);
  if (Math.abs(y % 1) === 0.5 && r % 2 !== 0) return (r - 1) / m;
  return r / m;
}
function jsonDumps(obj) {
  return JSON.stringify(obj, null, 2);
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
function repr(v) {
  if (v === null || v === void 0) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return JSON.stringify(v);
  const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
  let out = "";
  for (const c of v) {
    if (c === "\\") out += "\\\\";
    else if (c === quote) out += "\\" + c;
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "	") out += "\\t";
    else out += c;
  }
  return quote + out + quote;
}
function strip(s) {
  return s.replace(/^\s+|\s+$/g, "");
}
function rstrip(s, chars) {
  if (chars === void 0) return s.replace(/\s+$/, "");
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}
function lstrip(s) {
  return s.replace(/^\s+/, "");
}
function counter(start = 1) {
  let n = start;
  return () => n++;
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// src/blocks.ts
var DETAILS_RE = /<details>([\s\S]*?)<\/details>[ \t]*\n?/gi;
var SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;
var MERMAID_FENCE_RE = /^```mermaid[^\n]*\n([\s\S]*?)\n```\s*$/;
var DIAGRAM_IMG_RE = /(?:^|\n)!\[[^\]]*\]\(([^)]+)\)[ \t]*\n\s*$/;
var PAGEBREAK = "<!-- pagebreak -->";
var LAYOUT_COMMENT_RE = /^<!--\s*layout:([\s\S]*?)-->$/;
var ImportNotes = class {
  droppedDetails = [];
  expandedDetails = 0;
  rescuedMermaid = 0;
  discardedImages = [];
  htmlBlocks = 0;
  ignoredHr = 0;
  /** blocks (code, table, quote ...) inside a nested list item: a nested item cannot hold them */
  droppedListBlocks = [];
  toDict() {
    return {
      droppedDetails: this.droppedDetails,
      expandedDetails: this.expandedDetails,
      rescuedMermaid: this.rescuedMermaid,
      discardedImages: this.discardedImages,
      htmlBlocks: this.htmlBlocks,
      ignoredHr: this.ignoredHr,
      droppedListBlocks: this.droppedListBlocks
    };
  }
};
function preprocessMarkdown(text, detailsMode, notes) {
  const repl = (inner0) => {
    let inner = inner0;
    let summary = "";
    const sm = SUMMARY_RE.exec(inner);
    if (sm) {
      summary = strip(sm[1]);
      inner = inner.slice(0, sm.index) + inner.slice(sm.index + sm[0].length);
    }
    const stripped = strip(inner);
    const fm = MERMAID_FENCE_RE.exec(stripped);
    if (fm) {
      notes.rescuedMermaid += 1;
      return "\n```mermaid\n" + fm[1] + "\n```\n";
    }
    if (detailsMode === "drop") {
      notes.droppedDetails.push([...stripped].slice(0, 40).join("").replace(/\n/g, " "));
      return "\n";
    }
    notes.expandedDetails += 1;
    const head2 = summary ? `
#### ${summary}

` : "\n";
    return head2 + stripped + "\n";
  };
  const out = [];
  let last = 0;
  for (const m of text.matchAll(DETAILS_RE)) {
    let before = text.slice(last, m.index);
    const replacement = repl(m[1]);
    if (replacement.startsWith("\n```mermaid")) {
      const im = DIAGRAM_IMG_RE.exec(before);
      if (im) {
        notes.discardedImages.push(im[1]);
        before = before.slice(0, im.index) + "\n";
      }
    }
    out.push(before, replacement);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out.join("");
}
function parseBlocks(text, hrBreak, notes) {
  return fold(md.parse(text, {}), hrBreak, notes);
}
function words(s) {
  return s.split(/\s+/).filter(Boolean);
}
function fold(tokens, hrBreak, notes) {
  const blocks = [];
  let i = 0;
  const n = tokens.length;
  while (i < n) {
    const tok = tokens[i];
    const t = tok.type;
    if (t === "heading_open") {
      const inline = tokens[i + 1];
      blocks.push({ type: "heading", level: parseInt(tok.tag[1], 10), text: strip(inline.content) });
      i += 3;
    } else if (t === "paragraph_open") {
      blocks.push(paragraphBlock(tokens[i + 1]));
      i += 3;
    } else if (t === "bullet_list_open" || t === "ordered_list_open") {
      const j = findClose(tokens, i);
      blocks.push(...listBlocks(tokens.slice(i, j + 1), hrBreak, notes));
      i = j + 1;
    } else if (t === "table_open") {
      const j = findClose(tokens, i);
      blocks.push(tableBlock(tokens.slice(i, j + 1)));
      i = j + 1;
    } else if (t === "fence") {
      const info = strip(tok.info || "");
      const first = words(info)[0];
      if (first === "mermaid") {
        blocks.push({ type: "mermaid", source: rstrip(tok.content, "\n") });
      } else {
        blocks.push({ type: "code", lang: info ? first : null, lines: rstrip(tok.content, "\n").split("\n") });
      }
      i += 1;
    } else if (t === "code_block") {
      blocks.push({ type: "code", lang: null, lines: rstrip(tok.content, "\n").split("\n") });
      i += 1;
    } else if (t === "blockquote_open") {
      const j = findClose(tokens, i);
      const parts = tokens.slice(i, j).filter((tk) => tk.type === "inline").map((tk) => strip(tk.content));
      blocks.push({ type: "quote", text: parts.join("\n\n") });
      i = j + 1;
    } else if (t === "html_block") {
      const content = strip(tok.content);
      const lm = LAYOUT_COMMENT_RE.exec(content);
      if (content === PAGEBREAK) {
        blocks.push({ type: "pagebreak" });
      } else if (lm) {
        blocks.push({ type: "layout", settings: strip(lm[1]) });
      } else {
        notes.htmlBlocks += 1;
        blocks.push({ type: "html", html: content });
      }
      i += 1;
    } else if (t === "hr") {
      if (hrBreak) blocks.push({ type: "pagebreak" });
      else notes.ignoredHr += 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return blocks;
}
function findClose(tokens, i) {
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    depth += tokens[j].nesting;
    if (depth === 0) return j;
  }
  throw new RangeError("unbalanced token stream");
}
function paragraphBlock(inline) {
  const children = inline.children ?? [];
  const meaningful = children.filter((c) => !(c.type === "text" && !strip(c.content)));
  if (meaningful.length === 1 && meaningful[0].type === "image") {
    const img = meaningful[0];
    return { type: "image", src: String(img.attrGet("src") ?? ""), alt: img.content || "" };
  }
  return { type: "paragraph", text: strip(inline.content) };
}
var ITEM_BREAKERS = /* @__PURE__ */ new Set(["fence", "code_block", "table_open", "blockquote_open", "html_block", "hr", "heading_open"]);
var LIST_OPENS = /* @__PURE__ */ new Set(["bullet_list_open", "ordered_list_open"]);
function listBlocks(tokens, hrBreak, notes) {
  const ordered = tokens[0].type === "ordered_list_open";
  let start = ordered ? listStart(tokens[0]) : 1;
  const out = [];
  let current = [];
  for (const inner of itemSpans(tokens.slice(1, -1))) {
    const [item, rest] = itemOf(inner, ordered, false, notes);
    current.push(item);
    if (rest.length) {
      out.push(list(ordered, current, start));
      start += current.length;
      current = [];
      out.push(...fold(rest, hrBreak, notes));
    }
  }
  if (current.length) out.push(list(ordered, current, start));
  return out;
}
function list(ordered, items, start) {
  const block = { type: "list", ordered, items };
  if (ordered && start !== 1) block.start = start;
  return block;
}
function listStart(tok) {
  const value = tok.attrGet("start");
  return value !== null ? parseInt(String(value), 10) : 1;
}
function* itemSpans(tokens) {
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type !== "list_item_open") {
      i += 1;
      continue;
    }
    const j = findClose(tokens, i);
    yield tokens.slice(i + 1, j);
    i = j + 1;
  }
}
function itemOf(inner, parentOrdered, nested, notes) {
  const texts = [];
  const children = [];
  let childrenOrdered = null;
  let rest = [];
  let k = 0;
  while (k < inner.length) {
    const tk = inner[k];
    if (ITEM_BREAKERS.has(tk.type)) {
      if (!nested) {
        rest = inner.slice(k);
        break;
      }
      const end = tk.nesting === 1 ? findClose(inner, k) : k;
      notes.droppedListBlocks.push(describe(inner.slice(k, end + 1)));
      k = end + 1;
    } else if (tk.type === "paragraph_open") {
      texts.push(strip(inner[k + 1].content));
      k += 3;
    } else if (LIST_OPENS.has(tk.type)) {
      const m = findClose(inner, k);
      const subOrdered = tk.type === "ordered_list_open";
      if (childrenOrdered === null) childrenOrdered = subOrdered;
      children.push(...nestedItems(inner.slice(k + 1, m), subOrdered, notes));
      k = m + 1;
    } else if (tk.type === "inline") {
      texts.push(strip(tk.content));
      k += 1;
    } else {
      k += 1;
    }
  }
  const item = { text: texts.join(" ") };
  if (children.length) {
    item.children = children;
    if (childrenOrdered !== parentOrdered) item.childrenOrdered = childrenOrdered;
  }
  return [item, rest];
}
function nestedItems(tokens, ordered, notes) {
  return [...itemSpans(tokens)].map((inner) => itemOf(inner, ordered, true, notes)[0]);
}
function describe(tokens) {
  const tk = tokens[0];
  const text = tk.content || (tokens.find((t) => t.type === "inline")?.content ?? "");
  const kind = tk.type.endsWith("_open") ? tk.type.slice(0, -"_open".length) : tk.type;
  return `${kind}: ${[...strip(text)].slice(0, 40).join("")}`.replace(/\n/g, " ");
}
function tableBlock(tokens) {
  let header = [];
  const align = [];
  const rows = [];
  let inHead = false;
  let row = null;
  for (const tk of tokens) {
    if (tk.type === "thead_open") inHead = true;
    else if (tk.type === "thead_close") inHead = false;
    else if (tk.type === "tr_open") row = [];
    else if (tk.type === "tr_close") {
      if (inHead) header = row ?? [];
      else rows.push(row ?? []);
      row = null;
    } else if (tk.type === "th_open" || tk.type === "td_open") {
      if (inHead) align.push(alignFromStyle(String(tk.attrGet("style") ?? "")));
    } else if (tk.type === "inline" && row !== null) {
      row.push(strip(tk.content));
    }
  }
  const block = { type: "table", header, rows };
  if (align.some((a) => a !== "left")) block.align = align;
  return block;
}
function alignFromStyle(style) {
  for (const a of ["center", "right"]) if (style.includes(a)) return a;
  return "left";
}
function docTitleFromBlocks(blocks, fallback) {
  for (const b of blocks) if (b.type === "heading" && b.level === 1) return b.text;
  return fallback;
}

// src/content.ts
import { closeSync, openSync, readFileSync as readFileSync2, readSync, writeFileSync } from "node:fs";
import { basename, dirname as dirname2, extname, join as join2 } from "node:path";

// src/version.ts
var VERSION = "0.8.0";

// src/content.ts
var FORMAT = "gospelo-document";
var SCHEMA_VERSION = 1;
var GENERATOR = `gospelo-md2html ${VERSION}`;
var DOC_SCRIPT_ID = "gospelo-document";
var SIGNATURE = `<!-- ${FORMAT} ${SCHEMA_VERSION} -->`;
var HTML_SUFFIX = ".gospelo.html";
var JSON_SUFFIX = ".gospelo.json";
var MIGRATION_URL = "https://github.com/gospelo-dev/md2html/blob/main/docs/MIGRATION.md";
var HEAD_CHUNK = 64 * 1024;
var PAGE_KINDS = ["source", "cover", "content"];
var BLOCK_SPEC = {
  heading: { level: ["int", true], text: ["str", true] },
  paragraph: { text: ["str", true] },
  list: { ordered: ["bool", true], items: ["list", true], start: ["int", false] },
  table: { header: ["list", true], rows: ["list", true], align: ["list", false], continued: ["bool", false] },
  code: { lang: ["str?", true], lines: ["list", true], continued: ["bool", false] },
  image: { src: ["str", true], alt: ["str", true], caption: ["str?", false] },
  mermaid: { source: ["str", true] },
  quote: { text: ["str", true] },
  html: { html: ["str", true] },
  markdown: { text: ["str", true] },
  pagebreak: {}
};
var FIGURE_TYPES = /* @__PURE__ */ new Set(["image", "mermaid"]);
var ContentError = class extends Error {
};
function kindOk(kind, v) {
  switch (kind) {
    case "int":
      return typeof v === "number" && Number.isInteger(v);
    case "str":
      return typeof v === "string";
    case "str?":
      return typeof v === "string" || v === null;
    case "list":
      return Array.isArray(v);
    case "bool":
      return typeof v === "boolean";
  }
}
function isHtmlPath(path) {
  const ext = extname(path).toLowerCase();
  return ext === ".html" || ext === ".htm";
}
function defaultHtmlPath(path) {
  let name = basename(path);
  const lower = name.toLowerCase();
  const suffix = [JSON_SUFFIX, HTML_SUFFIX].find((s) => lower.endsWith(s));
  if (suffix) name = name.slice(0, -suffix.length);
  else {
    const ext = extname(name);
    name = ext ? name.slice(0, -ext.length) : name;
  }
  return join2(dirname2(path), name + HTML_SUFFIX);
}
function makeEnvelope(doc, layout, pages) {
  const srcPage = doc.pages.length && doc.pages[0].kind === "source" ? doc.pages[0] : null;
  const body = pages !== void 0 ? [...pages] : doc.pages.filter((p) => p.kind !== "source");
  const env = {
    format: FORMAT,
    version: SCHEMA_VERSION,
    generator: GENERATOR,
    meta: { ...doc.meta },
    layout: { ...layout },
    pages: [...srcPage ? [srcPage] : [], ...body]
  };
  if (doc.extras && Object.keys(doc.extras).length) env.extras = doc.extras;
  return stripRuntimeIds(env);
}
function splitEnvelope(env, where) {
  if (!isObject(env) || env.format !== FORMAT) {
    throw new ContentError(
      `${where}: not a Gospelo Document (no "format": "${FORMAT}"). Files written by earlier md2html releases must be converted first: ${MIGRATION_URL}`
    );
  }
  if (env.version !== SCHEMA_VERSION) {
    throw new ContentError(`${where}: unsupported ${FORMAT} version ${repr(env.version)} (this tool reads ${SCHEMA_VERSION})`);
  }
  for (const key of Object.keys(env)) {
    if (!["format", "version", "generator", "meta", "layout", "pages", "extras"].includes(key)) {
      throw new ContentError(`${where}: unknown top-level key ${repr(key)}`);
    }
  }
  if ("generator" in env && typeof env.generator !== "string") {
    throw new ContentError(`${where}: generator must be a string`);
  }
  const layout = env.layout;
  if (!isObject(layout)) throw new ContentError(`${where}: layout must be an object`);
  const doc = { version: SCHEMA_VERSION, meta: env.meta, pages: env.pages };
  if ("extras" in env) doc.extras = env.extras;
  validateContent(doc, where);
  return [doc, layout];
}
function loadDocument(path) {
  let env;
  if (isHtmlPath(path)) {
    env = envelopeFromHtml(readHead(path), path);
  } else {
    let text;
    try {
      text = readFileSync2(path, "utf-8");
    } catch {
      throw new ContentError(`document not found: ${path}`);
    }
    try {
      env = JSON.parse(text);
    } catch (e) {
      throw new ContentError(`document is not valid JSON: ${path}: ${e.message}`);
    }
  }
  const [doc, layout] = splitEnvelope(env, path);
  assignBlockIds(doc);
  return [doc, layout];
}
function saveDocument(doc, layout, path) {
  writeFileSync(path, jsonDumps(makeEnvelope(doc, layout)) + "\n", "utf-8");
}
function stripRuntimeIds(doc) {
  const copy = JSON.parse(JSON.stringify(doc));
  for (const page of copy.pages) {
    for (const key of Object.keys(page)) if (key.startsWith("_")) delete page[key];
    for (const block of page.blocks) {
      if (block._generated_id) {
        delete block.id;
        delete block._generated_id;
      }
    }
  }
  return copy;
}
function assignBlockIds(doc) {
  for (const page of doc.pages) {
    page.blocks.forEach((block, i) => {
      if (!("id" in block)) {
        block.id = `${page.id}-b${i}`;
        block._generated_id = true;
      }
    });
  }
}
function embedJson(obj) {
  return jsonDumps(obj).replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}
function envelopeScript(env) {
  return `<script type="application/json" id="${DOC_SCRIPT_ID}">
` + embedJson(env) + "\n</script>";
}
var OPEN_TAG = `<script type="application/json" id="${DOC_SCRIPT_ID}">`;
var CLOSE_TAG = "</script>";
function readHead(path) {
  let fd;
  try {
    fd = openSync(path, "r");
  } catch {
    throw new ContentError(`document not found: ${path}`);
  }
  try {
    const chunks = [];
    const buf = Buffer.alloc(HEAD_CHUNK);
    let text = "";
    let start = -1;
    for (; ; ) {
      const n = readSync(fd, buf, 0, HEAD_CHUNK, null);
      if (n > 0) chunks.push(Buffer.from(buf.subarray(0, n)));
      text = Buffer.concat(chunks).toString("utf-8");
      if (start < 0) {
        start = text.indexOf(OPEN_TAG);
        if (start < 0) {
          if (chunks.length === 1 || n === 0) notGospelo(text, path);
        }
      }
      if (start >= 0) {
        const end = text.indexOf(CLOSE_TAG, start + OPEN_TAG.length);
        if (end >= 0) return text.slice(0, end + CLOSE_TAG.length);
      }
      if (n === 0) throw new ContentError(`${path}: the ${DOC_SCRIPT_ID} block is not terminated`);
    }
  } finally {
    closeSync(fd);
  }
}
function notGospelo(head2, where) {
  const legacy = head2.includes("data-mermaid-font-size=") || head2.includes('id="md2html-content"') || head2.includes('id="page-0"');
  const hint = legacy ? "it was written by an earlier md2html release; convert it first: " : "it was not generated by md2html build, or the block was removed. Conversion notes: ";
  throw new ContentError(`${where}: no <script id="${DOC_SCRIPT_ID}"> envelope found; ${hint}${MIGRATION_URL}`);
}
function envelopeFromHtml(text, where) {
  const start = text.indexOf(OPEN_TAG);
  if (start < 0) notGospelo(text, where);
  const end = text.indexOf(CLOSE_TAG, start + OPEN_TAG.length);
  if (end < 0) throw new ContentError(`${where}: the ${DOC_SCRIPT_ID} block is not terminated`);
  try {
    return JSON.parse(text.slice(start + OPEN_TAG.length, end));
  } catch (e) {
    throw new ContentError(`${where}: embedded ${DOC_SCRIPT_ID} JSON is not valid: ${e.message}`);
  }
}
function validateContent(doc, where = "content") {
  if (!isObject(doc)) throw new ContentError(`${where}: top level must be an object`);
  if (doc.version !== SCHEMA_VERSION) {
    throw new ContentError(`${where}: version must be ${SCHEMA_VERSION} (got ${repr(doc.version)})`);
  }
  const meta = doc.meta;
  if (!isObject(meta)) throw new ContentError(`${where}: meta must be an object`);
  if (typeof meta.title !== "string") throw new ContentError(`${where}: meta.title must be a string`);
  if (!(typeof meta.date === "string" || meta.date === null || meta.date === void 0)) {
    throw new ContentError(`${where}: meta.date must be a string or null`);
  }
  if (!(typeof meta.source === "string" || meta.source === null || meta.source === void 0)) {
    throw new ContentError(`${where}: meta.source must be a string or null`);
  }
  if ("lang" in meta && (typeof meta.lang !== "string" || !meta.lang)) {
    throw new ContentError(`${where}: meta.lang must be a non-empty string`);
  }
  for (const key of Object.keys(meta)) {
    if (!["title", "date", "source", "lang", "extras"].includes(key)) {
      throw new ContentError(`${where}: meta has unknown key ${repr(key)}`);
    }
  }
  if ("extras" in meta && !isObject(meta.extras)) throw new ContentError(`${where}: meta.extras must be an object`);
  if ("extras" in doc && !isObject(doc.extras)) throw new ContentError(`${where}: extras must be an object`);
  const pages = doc.pages;
  if (!Array.isArray(pages) || !pages.length) throw new ContentError(`${where}: pages must be a non-empty array`);
  const seen = /* @__PURE__ */ new Set();
  pages.forEach((page, idx) => {
    validatePage(page, idx, where);
    if (seen.has(page.id)) throw new ContentError(`${where}: duplicate page id ${repr(page.id)}`);
    seen.add(page.id);
  });
  if (!pages.some((p) => p.kind !== "source")) {
    throw new ContentError(`${where}: at least one cover or content page is required`);
  }
}
function validatePage(page, idx, where) {
  const loc = `${where}: pages[${idx}]`;
  if (!isObject(page)) throw new ContentError(`${loc} must be an object`);
  for (const key of ["id", "kind", "title", "continued", "blocks"]) {
    if (!(key in page)) throw new ContentError(`${loc} is missing ${repr(key)}`);
  }
  for (const key of Object.keys(page)) {
    if (!["id", "kind", "title", "continued", "blocks", "extras"].includes(key) && !key.startsWith("_")) {
      throw new ContentError(`${loc} has unknown key ${repr(key)}`);
    }
  }
  if (typeof page.id !== "string" || !page.id) throw new ContentError(`${loc}.id must be a non-empty string`);
  if (!PAGE_KINDS.includes(page.kind)) {
    throw new ContentError(`${loc}.kind must be one of ('source', 'cover', 'content')`);
  }
  if (!(typeof page.title === "string" || page.title === null)) throw new ContentError(`${loc}.title must be a string or null`);
  if (typeof page.continued !== "boolean") throw new ContentError(`${loc}.continued must be a boolean`);
  if (!Array.isArray(page.blocks)) throw new ContentError(`${loc}.blocks must be an array`);
  if ("extras" in page && !isObject(page.extras)) throw new ContentError(`${loc}.extras must be an object`);
  if (page.kind === "source") {
    if (idx !== 0) throw new ContentError(`${loc}: a source page must be pages[0]`);
    if (page.blocks.length !== 1 || page.blocks[0]?.type !== "markdown") {
      throw new ContentError(`${loc}: a source page must contain exactly one markdown block`);
    }
  }
  page.blocks.forEach((block, bIdx) => validateBlock(block, `${loc}.blocks[${bIdx}]`, page.kind));
}
function validateBlock(block, loc, pageKind) {
  if (!isObject(block)) throw new ContentError(`${loc} must be an object`);
  const btype = block.type;
  const spec = BLOCK_SPEC[btype];
  if (typeof btype !== "string" || spec === void 0) {
    throw new ContentError(`${loc}.type ${repr(btype)} is not a known block type`);
  }
  if (btype === "markdown" && pageKind !== "source") {
    throw new ContentError(`${loc}: markdown blocks are only allowed on the source page`);
  }
  if ("id" in block && (typeof block.id !== "string" || !block.id)) throw new ContentError(`${loc}.id must be a non-empty string`);
  for (const [key, [kind, required]] of Object.entries(spec)) {
    if (!(key in block)) {
      if (required) throw new ContentError(`${loc} (${btype}) is missing ${repr(key)}`);
      continue;
    }
    if (!kindOk(kind, block[key])) throw new ContentError(`${loc}.${key} has wrong type for ${btype}`);
  }
  for (const key of Object.keys(block)) {
    if (!(key in spec) && !["type", "id", "_generated_id"].includes(key)) {
      throw new ContentError(`${loc} (${btype}) has unknown key ${repr(key)}`);
    }
  }
  if (btype === "heading" && !(block.level >= 1 && block.level <= 4)) {
    throw new ContentError(`${loc}: heading level must be 1 to 4`);
  }
  if (btype === "list") validateItems(block.items, loc);
  if (btype === "table") {
    const header = block.header;
    const ncols = header.length;
    if (ncols === 0 || !header.every((h) => typeof h === "string")) {
      throw new ContentError(`${loc}: table header must be a non-empty array of strings`);
    }
    ;
    block.rows.forEach((row, rIdx) => {
      if (!Array.isArray(row) || !row.every((c) => typeof c === "string")) {
        throw new ContentError(`${loc}.rows[${rIdx}] must be an array of strings`);
      }
      if (row.length !== ncols) throw new ContentError(`${loc}.rows[${rIdx}] has ${row.length} cells, header has ${ncols}`);
    });
    if ("align" in block) {
      const align = block.align;
      if (align.length !== ncols || !align.every((a) => a === "left" || a === "center" || a === "right")) {
        throw new ContentError(`${loc}.align must list left/center/right for each column`);
      }
    }
  }
  if (btype === "code" && !block.lines.every((l) => typeof l === "string")) {
    throw new ContentError(`${loc}.lines must be an array of strings`);
  }
}
function validateItems(items, loc) {
  if (!Array.isArray(items)) throw new ContentError(`${loc}.items must be an array`);
  if (!items.length) throw new ContentError(`${loc}.items must not be empty`);
  items.forEach((item, i) => {
    if (!isObject(item) || typeof item.text !== "string") {
      throw new ContentError(`${loc}.items[${i}] must be an object with a text string`);
    }
    for (const key of Object.keys(item)) {
      if (!["text", "children", "childrenOrdered"].includes(key)) {
        throw new ContentError(`${loc}.items[${i}] has unknown key ${repr(key)}`);
      }
    }
    if ("childrenOrdered" in item) {
      if (typeof item.childrenOrdered !== "boolean") throw new ContentError(`${loc}.items[${i}].childrenOrdered must be a boolean`);
      if (!("children" in item)) throw new ContentError(`${loc}.items[${i}].childrenOrdered requires children`);
    }
    if ("children" in item) validateItems(item.children, `${loc}.items[${i}]`);
  });
}
function makeSourcePage(markdownText) {
  return { id: "p00", kind: "source", title: null, continued: false, blocks: [{ type: "markdown", text: markdownText }] };
}
function getSourceMarkdown(doc) {
  const first = doc.pages[0];
  return first.kind === "source" ? first.blocks[0].text : null;
}
function contentPages(doc) {
  return doc.pages.filter((p) => p.kind !== "source");
}
function restoreMarkdown(path) {
  const [doc] = loadDocument(path);
  const src = getSourceMarkdown(doc);
  if (src === null) throw new ContentError(`${path}: this document has no page 0 source backup`);
  return src;
}

// src/fonts.ts
import { existsSync as existsSync2, readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
import subsetFont from "subset-font";
var FONT_DIR = join3(VENDOR, "fonts", "bizud");
var DEFAULT_BODY_STACK = "-apple-system, 'Helvetica Neue', 'BIZ UDPGothic', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif";
var DEFAULT_CODE_STACK = "'SFMono-Regular', Menlo, 'BIZ UDGothic', 'Noto Sans Mono CJK JP', monospace";
var ALWAYS = "0123456789 /()\uFF08\u7D9A\u304D\uFF09.-:";
var ASCII = Array.from({ length: 127 - 32 }, (_, i) => String.fromCharCode(32 + i)).join("");
var VENDORED = [
  { family: "BIZ UDPGothic", weight: 400, file: "BIZUDPGothic-Regular.woff2" },
  { family: "BIZ UDPGothic", weight: 700, file: "BIZUDPGothic-Bold.woff2" },
  { family: "BIZ UDGothic", weight: 400, file: "BIZUDGothic-Regular.woff2" },
  { family: "BIZ UDGothic", weight: 700, file: "BIZUDGothic-Bold.woff2" }
];
function inlineRuns(text) {
  const runs2 = [];
  let strong = 0;
  for (const tok of inlineTokens(text)) {
    if (tok.type === "strong_open") strong++;
    else if (tok.type === "strong_close") strong--;
    else if (tok.type === "code_inline") runs2.push(["code", tok.content]);
    else if (tok.type === "text") runs2.push([strong ? "bold" : "body", tok.content]);
    else if (tok.type === "html_inline") {
      runs2.push(["body", tok.content]);
      runs2.push(["bold", tok.content]);
    }
  }
  return runs2;
}
function characterSets(blocks, titles, extra = "") {
  const parts = { body: [ALWAYS, extra], bold: [ALWAYS, extra], code: [ASCII, ALWAYS] };
  const inline = (text, bold = false) => {
    for (const [kind, s] of inlineRuns(text)) parts[bold && kind === "body" ? "bold" : kind].push(s);
  };
  const items = (lst) => {
    for (const it of lst) {
      inline(it.text);
      if (it.children?.length) items(it.children);
    }
  };
  for (const t of titles) parts.bold.push(t);
  for (const b of blocks) {
    const t = b.type;
    if (t === "heading") inline(b.text, true);
    else if (t === "paragraph" || t === "quote") inline(b.text);
    else if (t === "list") items(b.items);
    else if (t === "table") {
      for (const h of b.header) inline(h, true);
      for (const row of b.rows) for (const c of row) inline(c);
    } else if (t === "code") parts.code.push(b.lines.join("\n"));
    else if (t === "mermaid") {
      parts.body.push(b.source);
      parts.bold.push(b.source);
    } else if (t === "image") inline(b.caption || b.alt);
    else if (t === "html" || t === "markdown") {
      const raw = b.html || b.text || "";
      for (const k of Object.keys(parts)) parts[k].push(raw);
    }
  }
  const body = parts.body.join("") + parts.bold.join("");
  return { body, bold: parts.bold.join(""), code: parts.code.join("") };
}
function facesToEmbed(fontFamily, codeFontFamily) {
  const bodyStack = fontFamily || DEFAULT_BODY_STACK;
  const codeStack = codeFontFamily || DEFAULT_CODE_STACK;
  const out = [];
  for (const f of VENDORED) {
    const roles = [];
    if (bodyStack.includes(f.family)) roles.push(f.weight === 400 ? "body" : "bold");
    if (codeStack.includes(f.family) && f.weight === 400) roles.push("code");
    if (roles.length) out.push([f, roles]);
  }
  return out;
}
var ALL_NAME_IDS = Array.from({ length: 256 }, (_, i) => i);
async function subsetWoff2(path, text) {
  if (!existsSync2(path)) throw new AssetError(`required asset is missing: ${path}`);
  return subsetFont(readFileSync3(path), text, {
    targetFormat: "woff2",
    noHinting: true,
    preserveNameIds: ALL_NAME_IDS,
    // BIZ UD carries a 'meta' table the Python version dropped; drop it here too
    dropTables: ["meta"]
  });
}
async function fontFaceCss(texts, fontFamily, codeFontFamily) {
  const rules = [];
  for (const [f, roles] of facesToEmbed(fontFamily, codeFontFamily)) {
    const text = roles.map((r) => texts[r]).join("");
    const data = (await subsetWoff2(join3(FONT_DIR, f.file), text)).toString("base64");
    rules.push(
      `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; font-style: normal; font-display: block; src: url(data:font/woff2;base64,${data}) format('woff2'); }`
    );
  }
  return rules.join("\n") + (rules.length ? "\n" : "");
}
async function embeddedFontCss(blocks, titles, layout, extra = "") {
  if (!layout.embedFonts) return "";
  if (!facesToEmbed(layout.fontFamily, layout.codeFontFamily).length) return "";
  return fontFaceCss(characterSets(blocks, titles, extra), layout.fontFamily, layout.codeFontFamily);
}

// src/formats.ts
var MM_TO_PX = 96 / 25.4;
var PT_TO_PX = 96 / 72;
function fmt(id, w, h, mv, mh, pt, slide, cols) {
  return { id, widthMm: w, heightMm: h, marginVMm: mv, marginHMm: mh, defaultFontPt: pt, isSlide: slide, defaultColumns: cols };
}
var FORMATS = {
  a4: fmt("a4", 210, 297, 18, 18, 11, false, "single"),
  "a4-landscape": fmt("a4-landscape", 297, 210, 16, 20, 11, false, "two"),
  a3: fmt("a3", 297, 420, 22, 22, 12, false, "single"),
  "a3-landscape": fmt("a3-landscape", 420, 297, 20, 24, 12, false, "two"),
  "16x9": fmt("16x9", 338.6667, 190.5, 10, 12, 14, true, "two"),
  "4x3": fmt("4x3", 254, 190.5, 10, 12, 14, true, "two")
};
var PAGE_IDS = Object.keys(FORMATS);
function getFormat(pageId) {
  const f = FORMATS[pageId];
  if (!f) {
    throw new RangeError(`unknown page format: '${pageId}' (expected one of ${PAGE_IDS.join(", ")})`);
  }
  return f;
}

// src/layout.ts
import { readFileSync as readFileSync4 } from "node:fs";
var LayoutError = class extends Error {
};
var LAYOUT_KEYS = {
  page: "string",
  fontSize: "string",
  fontFamily: "string?",
  codeFontFamily: "string?",
  embedFonts: "boolean",
  titleScale: "number",
  headerTitle: "string",
  columns: "string",
  figureSide: "string",
  splitRatio: "number",
  gutter: "string?",
  details: "string",
  mermaidLib: "string",
  mermaidVersion: "string?",
  hrBreak: "boolean",
  imageScale: "number",
  embedImages: "boolean",
  date: "string?",
  css: "string?",
  overrides: "object"
};
var PAGE_OVERRIDE_KEYS = /* @__PURE__ */ new Set(["columns", "figureSide", "splitRatio", "gutter"]);
var BLOCK_OVERRIDE_KEYS = /* @__PURE__ */ new Set(["maxHeightRatio", "span"]);
var MERMAID_LIB = "prerender";
var Layout = class {
  page = "a4";
  fontSize = null;
  fontFamily = null;
  codeFontFamily = null;
  embedFonts = true;
  titleScale = 1.25;
  headerTitle = "section";
  columns = null;
  figureSide = "right";
  splitRatio = 0.5;
  gutter = null;
  details = "drop";
  mermaidLib = MERMAID_LIB;
  mermaidVersion = null;
  hrBreak = false;
  imageScale = 1;
  embedImages = false;
  date = null;
  css = null;
  overrides = {};
  pageOverride(pageId) {
    const o = this.overrides[pageId] ?? {};
    return Object.fromEntries(Object.entries(o).filter(([k]) => PAGE_OVERRIDE_KEYS.has(k)));
  }
  blockOverride(blockId) {
    const o = this.overrides[blockId] ?? {};
    return Object.fromEntries(Object.entries(o).filter(([k]) => BLOCK_OVERRIDE_KEYS.has(k)));
  }
  spanOverrides() {
    const out = {};
    for (const [k, v] of Object.entries(this.overrides)) {
      if (isObject(v) && (v.span === 1 || v.span === 2)) out[k] = v.span;
    }
    return out;
  }
};
function typeOk(kind, value) {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "string?":
      return typeof value === "string" || value === null;
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "object":
      return isObject(value);
  }
}
function loadLayoutFile(path) {
  let text;
  try {
    text = readFileSync4(path, "utf-8");
  } catch {
    throw new LayoutError(`layout file not found: ${path}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new LayoutError(`layout file is not valid JSON: ${path}: ${e.message}`);
  }
  if (!isObject(data)) throw new LayoutError(`layout file must be a JSON object: ${path}`);
  for (const [key, value] of Object.entries(data)) {
    const kind = LAYOUT_KEYS[key];
    if (kind === void 0) throw new LayoutError(`unknown layout key ${repr(key)} in ${path}`);
    if (!typeOk(kind, value)) throw new LayoutError(`layout key ${repr(key)} has wrong type in ${path}`);
  }
  validateOverrides(data.overrides ?? {}, path);
  return data;
}
function validateOverrides(overrides, path) {
  for (const [target, values] of Object.entries(overrides)) {
    if (!isObject(values)) throw new LayoutError(`overrides[${repr(target)}] must be an object in ${path}`);
    for (const k of Object.keys(values)) {
      if (!PAGE_OVERRIDE_KEYS.has(k) && !BLOCK_OVERRIDE_KEYS.has(k)) {
        throw new LayoutError(`unknown override key ${repr(k)} for ${repr(target)} in ${path}`);
      }
    }
    if ("span" in values && values.span !== 1 && values.span !== 2) {
      throw new LayoutError(`override span for ${repr(target)} must be 1 or 2 in ${path}`);
    }
    if ("columns" in values && !["two", "split", "single"].includes(values.columns)) {
      throw new LayoutError(`override columns for ${repr(target)} must be two, split or single in ${path}`);
    }
    if ("figureSide" in values && values.figureSide !== "left" && values.figureSide !== "right") {
      throw new LayoutError(`override figureSide for ${repr(target)} must be left or right in ${path}`);
    }
    if ("splitRatio" in values) {
      const r = values.splitRatio;
      if (typeof r !== "number" || !(r >= 0.4 && r <= 0.6)) {
        throw new LayoutError(`override splitRatio for ${repr(target)} must be a number from 0.4 to 0.6 in ${path}`);
      }
    }
    if ("gutter" in values && (typeof values.gutter !== "string" || !GUTTER_SYNTAX.test(values.gutter))) {
      throw new LayoutError(`override gutter for ${repr(target)} must be a length such as 2em, 40px, 10mm or 30pt in ${path}`);
    }
  }
}
var GUTTER_SYNTAX = /^\s*[0-9]+(?:\.[0-9]+)?\s*(?:em|px|mm|pt)\s*$/;
function buildLayout(layoutPath, cli, base, mermaidVersion2) {
  const layout = new Layout();
  const set = layout;
  if (base) {
    for (const [key, value] of Object.entries(base)) {
      if (!(key in LAYOUT_KEYS)) throw new LayoutError(`unknown layout key ${repr(key)} in embedded layout`);
      set[key] = value;
    }
  }
  if (layoutPath !== null) {
    for (const [key, value] of Object.entries(loadLayoutFile(layoutPath))) set[key] = value;
  }
  for (const [key, value] of Object.entries(cli)) {
    if (value === void 0 || value === null) continue;
    if (!(key in LAYOUT_KEYS)) throw new LayoutError(`internal: unknown layout field ${repr(key)}`);
    set[key] = value;
  }
  check(layout, mermaidVersion2);
  return layout;
}
function layoutToDict(layout) {
  const out = {};
  for (const key of Object.keys(LAYOUT_KEYS)) {
    const value = layout[key];
    if (key === "overrides" && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}
function check(layout, mermaidVersion2) {
  if (!["section", "doc"].includes(layout.headerTitle) && !layout.headerTitle.startsWith("fixed:")) {
    throw new LayoutError(`invalid header title mode ${repr(layout.headerTitle)}`);
  }
  if (!["drop", "expand"].includes(layout.details)) {
    throw new LayoutError(`invalid details mode ${repr(layout.details)}`);
  }
  if (layout.gutter !== null && !GUTTER_SYNTAX.test(layout.gutter)) {
    throw new LayoutError(`invalid gutter ${repr(layout.gutter)}: expected a length such as 2em, 40px, 10mm or 30pt`);
  }
  validateOverrides(layout.overrides, "the layout");
  for (const [name, value] of [["fontFamily", layout.fontFamily], ["codeFontFamily", layout.codeFontFamily]]) {
    if (value !== null && (!value.trim() || /[<>{};]/.test(value))) {
      throw new LayoutError(
        `invalid ${name} ${repr(value)}: expected a CSS font-family list such as "'Noto Sans JP', sans-serif"`
      );
    }
  }
  if (layout.mermaidLib !== MERMAID_LIB) {
    throw new LayoutError(
      `mermaidLib ${repr(layout.mermaidLib)} is no longer supported: diagrams are drawn by mermaid-arch and written into the document as SVG. Rebuild with --mermaid-lib ${MERMAID_LIB}`
    );
  }
  if (layout.mermaidVersion !== null) {
    if (!/^\d+\.\d+\.\d+$/.test(layout.mermaidVersion)) {
      throw new LayoutError(`invalid mermaid version ${repr(layout.mermaidVersion)}: expected MAJOR.MINOR.PATCH`);
    }
    if (layout.mermaidVersion !== mermaidVersion2) {
      throw new LayoutError(
        `this document was paginated with Mermaid ${layout.mermaidVersion}; this md2html draws diagrams with Mermaid ${mermaidVersion2} (from mermaid-arch). Diagram sizes, and so the pages, may change. Rebuild with --mermaid-version ${mermaidVersion2} to accept that (Mermaid ${mermaidVersion2} lays out flowcharts with elk unless a diagram sets layout: dagre)`
      );
    }
  }
  if (layout.imageScale <= 0) throw new LayoutError("image scale must be positive");
  if (layout.date !== null && layout.date !== "none" && !/^\d{4}-\d{2}-\d{2}$/.test(layout.date)) {
    throw new LayoutError(`invalid date ${repr(layout.date)}: expected YYYY-MM-DD or none`);
  }
}

// src/measure.ts
import { writeFileSync as writeFileSync2 } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "@gospelo/mermaid-arch";
var FIGURES_TIMEOUT_MS = 12e4;
var VIEWPORT = { width: 1280, height: 720 };
var MeasureError = class extends Error {
};
var Browser = class _Browser {
  browser;
  path;
  source;
  constructor(browser, path, source) {
    this.browser = browser;
    this.path = path;
    this.source = source;
  }
  /** Launch chrome-headless-shell the way mermaid-arch finds it (--chrome, CHROME_PATH,
   * PUPPETEER_EXECUTABLE_PATH, puppeteer's cache). Throws mermaid-arch's BuildError
   * (chrome-missing / chrome-launch-failed) with the install command. */
  static async launch(chrome) {
    const launched = await launchBrowser({ chrome });
    return new _Browser(launched.browser, launched.path, launched.source);
  }
  async close() {
    await this.browser.close();
  }
  /** Open a generated HTML and wait for figures.js. `scale` is the device scale
   * factor (screenshots at 96 dpi x scale). */
  async open(htmlPath, scale = 1) {
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ ...VIEWPORT, deviceScaleFactor: scale });
      await page.goto(pathToFileURL(resolve(htmlPath)).href);
      await waitFigures(page);
      return page;
    } catch (e) {
      await page.close();
      throw e;
    }
  }
  async exportPdf(htmlPath, pdfPath) {
    const page = await this.open(htmlPath);
    try {
      await page.emulateMediaType("print");
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }
      });
      writeFileSync2(pdfPath, pdf);
    } finally {
      await page.close();
    }
  }
};
async function waitFigures(page) {
  await page.waitForFunction(
    "['done', 'error'].includes(document.documentElement.dataset.figures || '')",
    { timeout: FIGURES_TIMEOUT_MS }
  );
  const state = await page.evaluate("document.documentElement.dataset.figures");
  if (state !== "done") {
    const msg = await page.evaluate("document.documentElement.dataset.figuresError || ''");
    throw new MeasureError(`figure rendering failed: ${msg}`);
  }
}
async function call(page, fnSource, ...args) {
  return await page.evaluate(`(${fnSource})(${args.map((a) => JSON.stringify(a)).join(", ")})`);
}
var MEASURE_JS = String.raw`
(sel) => {
  const container = document.querySelector('.measure[data-measure="' + sel + '"]');
  if (!container) { return null; }
  const lineOffsets = (el) => {
    const offsets = [0];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, cum = 0, lastTop = null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + 1);
        const rects = r.getClientRects();
        if (rects.length) {
          const top = rects[0].top;
          if (lastTop === null) { lastTop = top; }
          else if (top > lastTop + 1) { offsets.push(cum); lastTop = top; }
        }
        cum++;
      }
    }
    return offsets;
  };
  const result = {};
  for (const el of container.querySelectorAll(':scope > [data-block]')) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const type = el.dataset.type;
    const entry = { type, height: rect.height, marginTop: parseFloat(cs.marginTop) || 0, marginBottom: parseFloat(cs.marginBottom) || 0 };
    if (type === 'paragraph') {
      entry.lineHeight = parseFloat(cs.lineHeight);
      entry.lineOffsets = lineOffsets(el);
    }
    if (type === 'table') {
      const thead = el.querySelector('thead');
      entry.thead = thead ? thead.getBoundingClientRect().height : 0;
      entry.rows = Array.from(el.querySelectorAll('tbody > tr')).map(tr => tr.getBoundingClientRect().height);
      entry.lineHeight = parseFloat(cs.lineHeight);
    }
    if (type === 'list') {
      entry.items = Array.from(el.querySelectorAll(':scope > li')).map(li => li.getBoundingClientRect().height + (parseFloat(getComputedStyle(li).marginBottom) || 0));
    }
    if (type === 'code') {
      entry.lines = Array.from(el.querySelectorAll('.line')).map(l => l.getBoundingClientRect().height);
      entry.padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + 2;
    }
    if (el.classList.contains('figure')) {
      entry.scale = parseFloat(el.dataset.scale || '1');
      entry.intrinsicW = parseFloat(el.dataset.intrinsicW || '0');
      entry.intrinsicH = parseFloat(el.dataset.intrinsicH || '0');
      entry.split = parseInt(el.dataset.split || '1', 10);
    }
    result[el.dataset.block] = entry;
  }
  return result;
}
`;
async function measureDocument(browser, htmlPath) {
  const page = await browser.open(htmlPath);
  try {
    const out = {};
    for (const sel of ["col", "single"]) {
      const data = await call(page, MEASURE_JS, sel);
      if (data !== null) out[sel] = data;
    }
    return out;
  } finally {
    await page.close();
  }
}
var VERIFY_JS = String.raw`
() => Array.from(document.querySelectorAll('.page')).map(p => {
  const col = p.querySelector('.column-text');
  const figCol = p.querySelector('.column-figure');
  const title = p.querySelector('.page-header .title');
  const blockInfo = (b) => {
    const e = { id: b.dataset.block, type: b.dataset.type, heightPx: Math.round(b.getBoundingClientRect().height * 10) / 10 };
    if (b.dataset.type === 'table') { e.rowHeightsPx = Array.from(b.querySelectorAll('tbody > tr')).map(tr => Math.round(tr.getBoundingClientRect().height * 10) / 10); }
    if (b.dataset.type === 'list') { e.itemHeightsPx = Array.from(b.querySelectorAll(':scope > li')).map(li => Math.round(li.getBoundingClientRect().height * 10) / 10); }
    if (b.dataset.type === 'code') { const l = b.querySelector('.line'); e.lineHeightPx = l ? Math.round(l.getBoundingClientRect().height * 10) / 10 : null; }
    if (b.classList.contains('figure')) { e.scale = parseFloat(b.dataset.scale || '1'); e.widthPx = Math.round(b.getBoundingClientRect().width); }
    return e;
  };
  let usedPx = 0, contentH = 0;
  if (col) {
    contentH = col.clientHeight;
    const top = col.getBoundingClientRect().top;
    // deepest visible bottom edge among the column's children (a two-column segment is as tall as
    // its taller column). The last block's bottom margin is not counted: it is invisible, and
    // pagination already reserves it, so counting it here reported overflow for pages that fit.
    const bottoms = Array.from(col.children).map(k => {
      const kids = k.classList.contains('segment') ? Array.from(k.querySelectorAll('[data-block]')) : [k];
      if (!kids.length) { return 0; }
      return Math.max(...kids.map(b => b.getBoundingClientRect().bottom - top));
    });
    usedPx = bottoms.length ? Math.max(...bottoms) : 0;
  }
  let figure = null, figureOverflowPx = 0;
  if (figCol) {
    const f = figCol.querySelector('figure');
    if (f) { figure = blockInfo(f); }
    figureOverflowPx = Math.max(0, figCol.scrollHeight - figCol.clientHeight);
  }
  return {
    id: p.dataset.pageId, mode: p.dataset.mode,
    contentHeightPx: Math.round(contentH), usedPx: Math.round(usedPx),
    overflowPx: Math.max(0, Math.round(usedPx - contentH)),
    figureOverflowPx: Math.round(figureOverflowPx),
    titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : false,
    blocks: col ? Array.from(col.querySelectorAll('[data-block]')).map(blockInfo) : [],
    figure
  };
})
`;
var CODE_HTML_JS = String.raw`
() => {
  const out = {};
  for (const pre of document.querySelectorAll('pre.code[data-highlighted="true"]')) {
    const bid = pre.dataset.block;
    const code = pre.querySelector('code');
    if (bid && code) { out[bid] = code.innerHTML; }
  }
  return out;
}
`;
async function verifyDocument(browser, htmlPath) {
  const page = await browser.open(htmlPath);
  try {
    return [await call(page, VERIFY_JS), await call(page, CODE_HTML_JS)];
  } finally {
    await page.close();
  }
}

// src/mermaid.ts
import { BuildError, createRenderer } from "@gospelo/mermaid-arch";

// src/render.ts
import { existsSync as existsSync3, readFileSync as readFileSync5, statSync as statSync2 } from "node:fs";
import { basename as basename2, extname as extname2, relative, resolve as resolve2, sep } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// src/inline.ts
var ESCAPE_CHARS = "\\*_`[]<~";
function renderInline(text) {
  return md.renderInline(text);
}
function escapeText(s) {
  let out = "";
  for (const c of s) out += ESCAPE_CHARS.includes(c) ? "\\" + c : c;
  return out;
}
function longestRun(s, ch) {
  let best = 0;
  let run = 0;
  for (const c of s) {
    if (c === ch) {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}
function serialize(tokens) {
  let out = "";
  const hrefs = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case "text":
        out += escapeText(tok.content);
        break;
      case "code_inline": {
        const fence = "`".repeat(longestRun(tok.content, "`") + 1);
        out += fence + tok.content + fence;
        break;
      }
      case "strong_open":
      case "strong_close":
        out += "**";
        break;
      case "em_open":
      case "em_close":
        out += "*";
        break;
      case "s_open":
      case "s_close":
        out += "~~";
        break;
      case "link_open":
        hrefs.push(tok.attrGet("href"));
        out += "[";
        break;
      case "link_close": {
        const href = hrefs.length ? hrefs.pop() : tok.attrGet("href");
        out += `](${href ?? ""})`;
        break;
      }
      case "image":
        out += `![${tok.content}](${tok.attrGet("src") ?? ""})`;
        break;
      case "softbreak":
        out += " ";
        break;
      case "hardbreak":
        out += "  \n";
        break;
      default:
        return null;
    }
  }
  return out;
}
var OPEN_TO_CLOSE = {
  strong_open: "strong_close",
  em_open: "em_close",
  s_open: "s_close",
  link_open: "link_close"
};
var CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));
function simpleToken(type, content, href = null) {
  return { type, content, attrGet: (name) => name === "href" ? href : null };
}
function splitInline(text, offset) {
  const tokens = inlineTokens(text);
  let pos = 0;
  let splitIdx = null;
  let splitInToken = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok2 = tokens[i];
    const length = tok2.type === "text" || tok2.type === "code_inline" ? tok2.content.length : tok2.type === "softbreak" ? 1 : 0;
    if (pos + length >= offset && length > 0) {
      splitIdx = i;
      splitInToken = offset - pos;
      break;
    }
    pos += length;
  }
  if (splitIdx === null) return null;
  const tok = tokens[splitIdx];
  let headTokens;
  let tailTokens;
  if (tok.type === "code_inline" || tok.type === "softbreak") {
    headTokens = tokens.slice(0, splitIdx);
    tailTokens = tok.type === "softbreak" ? tokens.slice(splitIdx + 1) : tokens.slice(splitIdx);
  } else {
    const headText = rstrip(tok.content.slice(0, splitInToken));
    const tailText = lstrip(tok.content.slice(splitInToken));
    headTokens = [...tokens.slice(0, splitIdx), ...headText ? [simpleToken("text", headText)] : []];
    tailTokens = [...tailText ? [simpleToken("text", tailText)] : [], ...tokens.slice(splitIdx + 1)];
  }
  const stack = [];
  for (const t of headTokens) {
    if (t.type in OPEN_TO_CLOSE) stack.push(t);
    else if (CLOSERS.has(t.type) && stack.length) stack.pop();
  }
  const closers = [...stack].reverse().map((t) => simpleToken(OPEN_TO_CLOSE[t.type], "", t.attrGet("href")));
  let head2 = serialize([...headTokens, ...closers]);
  let tail = serialize([...stack, ...tailTokens]);
  if (head2 === null || tail === null) return null;
  head2 = rstrip(head2);
  tail = lstrip(tail);
  if (!head2 || !tail) return null;
  return [head2, tail];
}

// src/scale.ts
var SIZE_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(pt|px|mm)\s*$/;
var TITLE_BAND_FACTOR = 2;
var FOOTER_MAX_BODY_RATIO = 0.75;
var FOOTER_MAX_MARGIN_RATIO = 0.36;
var SAFETY = 0.98;
var IMAGE_RATIO_SINGLE = 0.6;
var IMAGE_RATIO_SPLIT = 1;
function parseFontSize(value) {
  const m = SIZE_RE.exec(value);
  if (!m) throw new RangeError(`invalid --font-size ${repr(value)}: expected e.g. 11pt, 14px, 3.5mm`);
  const num = parseFloat(m[1]);
  const unit = m[2];
  if (num <= 0) throw new RangeError(`invalid --font-size ${repr(value)}: must be positive`);
  if (unit === "pt") return num * PT_TO_PX;
  if (unit === "mm") return num * MM_TO_PX;
  return num;
}
var DEFAULT_GUTTER = "2em";
var MAX_GUTTER_RATIO = 0.2;
var GUTTER_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(em|px|mm|pt)\s*$/;
function parseGutter(value, F) {
  const m = GUTTER_RE.exec(value);
  if (!m) throw new RangeError(`invalid gutter ${repr(value)}: expected e.g. 2.5em, 40px, 10mm, 30pt`);
  const num = parseFloat(m[1]);
  switch (m[2]) {
    case "em":
      return num * F;
    case "mm":
      return num * MM_TO_PX;
    case "pt":
      return num * PT_TO_PX;
    default:
      return num;
  }
}
var Metrics = class _Metrics {
  fmt;
  F;
  // body font px
  titleScale;
  columns;
  // document default
  figureSide;
  splitRatio;
  // text column fraction
  gutterPx;
  // gap between columns (split and two)
  constructor(fmt2, F, titleScale, columns, figureSide, splitRatio, gutterPx) {
    this.fmt = fmt2;
    this.F = F;
    this.titleScale = titleScale;
    this.columns = columns;
    this.figureSide = figureSide;
    this.splitRatio = splitRatio;
    this.gutterPx = gutterPx;
  }
  // ---- paper
  get pageWPx() {
    return this.fmt.widthMm * MM_TO_PX;
  }
  get pageHPx() {
    return this.fmt.heightMm * MM_TO_PX;
  }
  get marginVPx() {
    return this.fmt.marginVMm * MM_TO_PX;
  }
  get marginHPx() {
    return this.fmt.marginHMm * MM_TO_PX;
  }
  // ---- typography
  get lineHeight() {
    return this.fmt.isSlide ? 1.5 : 1.6;
  }
  get linePx() {
    return this.F * this.lineHeight;
  }
  get titleSizePx() {
    return this.F * this.titleScale;
  }
  get headerBandPx() {
    return this.fmt.isSlide ? this.titleSizePx * TITLE_BAND_FACTOR : 0;
  }
  get headerGapPx() {
    return this.fmt.isSlide ? this.F : 0;
  }
  get footerSizePx() {
    return Math.min(FOOTER_MAX_BODY_RATIO * this.F, FOOTER_MAX_MARGIN_RATIO * this.marginVPx);
  }
  get footerBandPx() {
    return this.marginVPx;
  }
  get tableScale() {
    return this.fmt.isSlide ? 0.85 : 0.9;
  }
  get codeScale() {
    return this.columns === "two" ? 0.6 : 0.85;
  }
  // ---- content box
  get contentWPx() {
    return this.pageWPx - 2 * this.marginHPx;
  }
  get contentHPx() {
    return this.pageHPx - this.marginVPx - this.footerBandPx - this.headerBandPx - this.headerGapPx;
  }
  get textColPx() {
    return (this.contentWPx - this.gutterPx) * this.splitRatio;
  }
  get figureColPx() {
    return (this.contentWPx - this.gutterPx) * (1 - this.splitRatio);
  }
  /** Width of one column in the two-column layout (left, then right). */
  get col2Px() {
    return (this.contentWPx - this.gutterPx) / 2;
  }
  /** [W, H, r] for figure sizing in the given page mode. */
  figureBox(mode, ratioOverride) {
    const usableH = this.contentHPx * SAFETY - 1;
    if (mode === "split") return [this.figureColPx, usableH, IMAGE_RATIO_SPLIT];
    if (mode === "col") return [this.col2Px, usableH, IMAGE_RATIO_SPLIT];
    const r = ratioOverride === void 0 || ratioOverride === null ? IMAGE_RATIO_SINGLE : ratioOverride;
    return [this.contentWPx, this.contentHPx, r];
  }
  /** These metrics with a page's own split ratio and gutter (layout overrides). */
  withColumns(splitRatio, gutterPx) {
    return new _Metrics(this.fmt, this.F, this.titleScale, this.columns, this.figureSide, splitRatio, gutterPx);
  }
  /** Whether the column widths differ from `other` (so text must be measured again). */
  sameColumns(other) {
    return this.splitRatio === other.splitRatio && this.gutterPx === other.gutterPx;
  }
  /** The column variables a page sets on its own <section> when they differ from the document's. */
  columnVars() {
    const textFr = pyRound(this.splitRatio * 2, 3);
    const figureFr = pyRound((1 - this.splitRatio) * 2, 3);
    return `--gutter: ${fixed(this.gutterPx, 3)}px; --text-fr: ${pyFloat(textFr)}fr; --figure-fr: ${pyFloat(figureFr)}fr;`;
  }
  cssVars() {
    const f = this.fmt;
    const textFr = pyRound(this.splitRatio * 2, 3);
    const figureFr = pyRound((1 - this.splitRatio) * 2, 3);
    const lines = [
      `--page-w: ${pyFloat(f.widthMm)}mm;`,
      `--page-h: ${pyFloat(f.heightMm)}mm;`,
      `--margin-v: ${pyFloat(f.marginVMm)}mm;`,
      `--margin-h: ${pyFloat(f.marginHMm)}mm;`,
      `--font-size: ${fixed(this.F, 3)}px;`,
      `--line-height: ${pyFloat(this.lineHeight)};`,
      `--title-size: ${fixed(this.titleSizePx, 3)}px;`,
      `--header-band: ${fixed(this.headerBandPx, 3)}px;`,
      `--header-gap: ${fixed(this.headerGapPx, 3)}px;`,
      `--footer-size: ${fixed(this.footerSizePx, 3)}px;`,
      `--footer-band: ${fixed(this.footerBandPx, 3)}px;`,
      `--content-w: ${fixed(this.contentWPx, 3)}px;`,
      `--content-h: ${fixed(this.contentHPx, 3)}px;`,
      `--gutter: ${fixed(this.gutterPx, 3)}px;`,
      `--text-fr: ${pyFloat(textFr)}fr;`,
      `--figure-fr: ${pyFloat(figureFr)}fr;`,
      `--table-scale: ${pyFloat(this.tableScale)};`,
      `--code-scale: ${pyFloat(this.codeScale)};`
    ];
    return ":root {\n  " + lines.join("\n  ") + "\n}\n";
  }
};
function buildMetrics(fmt2, fontSize, titleScale, columns, figureSide, splitRatio, gutter = null) {
  const F = fontSize ? parseFontSize(fontSize) : fmt2.defaultFontPt * PT_TO_PX;
  const cols = columns ?? fmt2.defaultColumns;
  if (cols !== "two" && cols !== "split" && cols !== "single") {
    throw new RangeError(`invalid columns ${repr(cols)}: expected two, split or single`);
  }
  if (figureSide !== "left" && figureSide !== "right") {
    throw new RangeError(`invalid figure side ${repr(figureSide)}: expected left or right`);
  }
  checkSplitRatio(splitRatio);
  if (titleScale <= 0) throw new RangeError(`invalid title scale ${titleScale}`);
  const m = new Metrics(fmt2, F, titleScale, cols, figureSide, splitRatio, 0);
  return m.withColumns(splitRatio, checkedGutter(gutter ?? DEFAULT_GUTTER, F, m.contentWPx));
}
function checkSplitRatio(splitRatio) {
  if (!(splitRatio >= 0.4 && splitRatio <= 0.6)) {
    throw new RangeError(`invalid split ratio ${splitRatio}: expected 0.4 to 0.6`);
  }
}
function checkedGutter(value, F, contentWPx) {
  const px = parseGutter(value, F);
  const max = contentWPx * MAX_GUTTER_RATIO;
  if (px > max) {
    throw new RangeError(
      `invalid gutter ${repr(value)}: ${fixed(px, 1)}px is wider than ${MAX_GUTTER_RATIO * 100}% of the content width (${fixed(max, 1)}px of ${fixed(contentWPx, 1)}px)`
    );
  }
  return px;
}

// src/render.ts
var RenderError = class extends Error {
};
function renderBlock(block, ctx, mode) {
  const t = block.type;
  const bid = block.id ?? "";
  let attr = ` data-block="${esc(bid)}" data-type="${t}"`;
  if (t === "heading") {
    const lvl = block.level;
    return `<h${lvl}${attr}>${renderInline(block.text)}</h${lvl}>`;
  }
  if (t === "paragraph") return `<p${attr}>${renderInline(block.text)}</p>`;
  if (t === "quote") {
    const paras = block.text.split("\n\n").map((p) => `<p>${renderInline(p)}</p>`).join("");
    return `<blockquote${attr}>${paras}</blockquote>`;
  }
  if (t === "list") {
    if ((block.start ?? 1) !== 1) attr += ` start="${Math.trunc(block.start)}"`;
    return renderList(block.items, block.ordered, attr, true);
  }
  if (t === "table") return renderTable(block, attr);
  if (t === "code") {
    const lang = block.lang ? ` data-lang="${esc(block.lang)}"` : "";
    const prerendered = ctx.codeHtml?.[bid];
    if (prerendered) return `<pre class="code"${attr}${lang} data-highlighted="true"><code>${prerendered}</code></pre>`;
    const lines = block.lines.map((line) => `<span class="line">${esc(line) || " "}</span>`).join("");
    const note = block.continued ? '<span class="continued-note">(\u7D9A\u304D)</span>' : "";
    return `<pre class="code"${attr}${lang}><code>${note}${lines}</code></pre>`;
  }
  if (t === "html") return `<div class="raw-html"${attr}>${block.html}</div>`;
  if (FIGURE_TYPES.has(t)) return renderFigure(block, ctx, mode, attr);
  if (t === "pagebreak") return "";
  throw new RenderError(`cannot render block type '${t}'`);
}
function renderList(items, ordered, attr, top) {
  const tag = ordered ? "ol" : "ul";
  const out = [`<${tag}${top ? attr : ""}>`];
  items.forEach((item, i) => {
    const marker = top ? ` data-item="${i}"` : "";
    let inner = renderInline(item.text);
    if (item.children?.length) {
      inner += renderList(item.children, item.childrenOrdered ?? ordered, "", false);
    }
    out.push(`<li${marker}>${inner}</li>`);
  });
  out.push(`</${tag}>`);
  return out.join("");
}
function zip(a, b) {
  return a.slice(0, Math.min(a.length, b.length)).map((x2, i) => [x2, b[i]]);
}
function renderTable(block, attr) {
  const align = block.align ?? block.header.map(() => "left");
  const cls = block.continued ? ' class="continued"' : "";
  const out = [`<table${cls}${attr}>`];
  if (block.continued) out.push("<caption>(\u7D9A\u304D)</caption>");
  out.push("<thead><tr>");
  for (const [h, a] of zip(block.header, align)) out.push(`<th class="${a}">${renderInline(h)}</th>`);
  out.push("</tr></thead><tbody>");
  block.rows.forEach((row, r) => {
    out.push(`<tr data-row="${r}">`);
    for (const [c, a] of zip(row, align)) out.push(`<td class="${a}">${renderInline(c)}</td>`);
    out.push("</tr>");
  });
  out.push("</tbody></table>");
  return out.join("");
}
function renderFigure(block, ctx, mode, attr) {
  const ratio = ctx.layout.blockOverride(block.id ?? "").maxHeightRatio;
  const [W, H, r] = ctx.metrics.figureBox(mode, ratio);
  const data = ` data-figure-w="${fixed(W, 2)}" data-figure-h="${fixed(H, 2)}" data-figure-r="${pyFloat(r)}" data-image-scale="${pyFloat(ctx.layout.imageScale)}"`;
  let body;
  let caption = "";
  if (block.type === "mermaid") {
    const svg = ctx.svgs.get(block.id ?? "");
    if (svg === void 0) throw new RenderError(`internal: Mermaid block ${block.id} has no drawn SVG`);
    body = svg;
  } else {
    const src = imageSrc(block.src, ctx);
    body = `<img src="${esc(src)}" alt="${esc(block.alt)}">`;
    const cap = block.caption || (block.alt && block.alt !== "diagram" ? block.alt : "");
    caption = cap ? `<figcaption>${renderInline(cap)}</figcaption>` : "";
  }
  return `<figure class="figure"${attr}${data}>${body}${caption}</figure>`;
}
function imageSrc(src, ctx) {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) return src;
  const absPath = resolve2(ctx.imageBase, src);
  if (ctx.embedImages) return dataUri(absPath);
  if (ctx.htmlDir === null) return pathToFileURL2(absPath).href;
  return relative(resolve2(ctx.htmlDir), absPath).split(sep).join("/");
}
var MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/vnd.microsoft.icon"
};
function dataUri(path) {
  const mime = MIME[extname2(path).toLowerCase()] ?? "application/octet-stream";
  if (!existsSync3(path) || !statSync2(path).isFile()) throw new RenderError(`image not found: ${path}`);
  return `data:${mime};base64,${readFileSync5(path).toString("base64")}`;
}
function renderPage(page, ctx, pageNo, total, docTitle, dateText2) {
  const fmt2 = ctx.metrics.fmt;
  const pid = page.id;
  const footerLeft = esc(docTitle) + (dateText2 ? ` <span class="date">${esc(dateText2)}</span>` : "");
  const footer = `<footer class="page-footer"><span class="footer-left">${footerLeft}</span><span class="page-number">${pageNo} / ${total}</span></footer>`;
  if (page.kind === "cover") {
    const h1 = page.blocks.find((b) => b.type === "heading" && b.level === 1);
    const subtitle = page.blocks.find((b) => b.type === "paragraph");
    let body = `<h1>${h1 ? renderInline(h1.text) : esc(docTitle)}</h1>`;
    if (subtitle) body += `<p class="subtitle">${renderInline(subtitle.text)}</p>`;
    if (dateText2) body += `<p class="date">${esc(dateText2)}</p>`;
    return `<section class="page cover" data-page-id="${esc(pid)}" data-mode="cover"><div class="page-body">${body}</div>${footer}</section>`;
  }
  const mode = pageMode(page, ctx);
  const pm = pageMetrics(page.id, ctx);
  const own = pm !== ctx.metrics;
  const pctx = own ? { ...ctx, metrics: pm } : ctx;
  let header = "";
  if (fmt2.isSlide) {
    const title = headerTitle(page, ctx, docTitle);
    const cont = page.continued ? ' <span class="continued">(\u7D9A\u304D)</span>' : "";
    header = `<header class="page-header"><span class="title">${renderInline(title)}${cont}</span></header>`;
  }
  let cols;
  if (mode === "two") {
    cols = renderTwoColumns(page, pctx);
  } else {
    const figure = mode !== "single" ? firstFigure(page) : null;
    const textBlocks = page.blocks.filter((b) => b !== figure);
    const figureMode = mode !== "single" ? "split" : "single";
    const colText = textBlocks.map((b) => renderBlock(b, pctx, figureMode)).join("\n");
    cols = `<div class="column-text">
${colText}
</div>`;
    if (figure !== null) cols += `
<div class="column-figure">${renderBlock(figure, pctx, "split")}</div>`;
  }
  const style = own ? ` style="${pm.columnVars()}"` : "";
  return `<section class="page" data-page-id="${esc(pid)}" data-mode="${mode}"${style}>${header}
<div class="page-body ${mode}">
${cols}
</div>
${footer}</section>`;
}
function pageMetrics(pageId, ctx) {
  return overrideMetrics(ctx.layout.pageOverride(pageId), ctx.metrics);
}
function overrideMetrics(ov, m) {
  const ratio = ov.splitRatio ?? m.splitRatio;
  const gutter = ov.gutter === void 0 ? m.gutterPx : checkedGutter(ov.gutter, m.F, m.contentWPx);
  if (ratio === m.splitRatio && gutter === m.gutterPx) return m;
  checkSplitRatio(ratio);
  return m.withColumns(ratio, gutter);
}
function renderTwoColumns(page, ctx) {
  const blocks = page.blocks;
  const layout = page._layout ?? blocks.map((_, i) => ({ kind: "wide", index: i }));
  const out = [];
  for (const seg of layout) {
    if (seg.kind === "cols") {
      const left = seg.left.map((i) => renderBlock(blocks[i], ctx, "col")).join("\n");
      const right = seg.right.map((i) => renderBlock(blocks[i], ctx, "col")).join("\n");
      out.push(
        `<div class="segment cols">
<div class="col col-left">
${left}
</div>
<div class="col col-right">
${right}
</div>
</div>`
      );
    } else {
      out.push(`<div class="segment wide">
${renderBlock(blocks[seg.index], ctx, "single")}
</div>`);
    }
  }
  return `<div class="column-text two">
${out.join("\n")}
</div>`;
}
function pageMode(page, ctx) {
  const ov = ctx.layout.pageOverride(page.id);
  const columns = ov.columns ?? ctx.metrics.columns;
  if (columns === "two") return "two";
  if (columns === "single" || firstFigure(page) === null) return "single";
  const side = ov.figureSide ?? ctx.metrics.figureSide;
  return `split-${side}`;
}
function firstFigure(page) {
  return page.blocks.find((b) => FIGURE_TYPES.has(b.type)) ?? null;
}
function headerTitle(page, ctx, docTitle) {
  const mode = ctx.layout.headerTitle;
  if (mode === "doc") return docTitle;
  if (mode.startsWith("fixed:")) return mode.slice("fixed:".length);
  return page.title || docTitle;
}
function head(ctx, title, needsFa, envelope, lang) {
  const m = ctx.metrics;
  const parts = ["<!DOCTYPE html>"];
  if (envelope !== null) parts.push(SIGNATURE);
  let htmlAttrs = ` lang="${esc(lang)}" data-mermaid-font-size="${mermaidFontSize(m)}"`;
  if (envelope !== null) htmlAttrs += ` data-gospelo-document="${SCHEMA_VERSION}"`;
  parts.push(`<html${htmlAttrs}>`, "<head>", '<meta charset="UTF-8">', `<title>${esc(title)}</title>`);
  if (envelope !== null) {
    parts.push(`<meta name="generator" content="${esc(GENERATOR)}">`);
    parts.push(envelopeScript(envelope));
  }
  parts.push("<style>\n" + ctx.fontCss + m.cssVars() + fontVars(ctx.layout) + baseCss() + "\n</style>");
  if (ctx.layout.css) parts.push("<style>\n" + readFileSync5(ctx.layout.css, "utf-8") + "\n</style>");
  if (needsFa) parts.push(fontawesomeStyleTag());
  parts.push("</head>");
  return parts.join("\n");
}
function mermaidFontSize(m) {
  return `${fixed(m.F * 0.9, 1)}px`;
}
function fontVars(layout) {
  const lines = [];
  if (layout.fontFamily) lines.push(`  --font-family: ${layout.fontFamily};`);
  if (layout.codeFontFamily) lines.push(`  --code-font-family: ${layout.codeFontFamily};`);
  return lines.length ? ":root {\n" + lines.join("\n") + "\n}\n" : "";
}
function tailScripts(needsShiki) {
  const parts = [];
  if (needsShiki) {
    const tag = shikiScriptTag();
    if (tag) parts.push(tag);
  }
  parts.push("<script>\n" + figuresJs() + "\n</script>");
  return parts;
}
function effectiveLayout(layout) {
  const out = layoutToDict(layout);
  out.mermaidLib = MERMAID_LIB;
  out.mermaidVersion = mermaidVersion();
  out.gutter = layout.gutter ?? DEFAULT_GUTTER;
  return out;
}
function needsFontAwesome(blocks) {
  return blocks.some((b) => b.type === "mermaid" && b.source.includes("fa:"));
}
function needs(blocks, codeHtml) {
  const codeWithLang = blocks.some((b) => b.type === "code" && b.lang);
  return [needsFontAwesome(blocks), codeWithLang && !codeHtml];
}
function renderDocument(doc, pages, ctx, dateText2) {
  const title = doc.meta.title;
  const allBlocks = pages.flatMap((p) => p.blocks);
  const [needsFa, needsShiki] = needs(allBlocks, ctx.codeHtml);
  const envelope = makeEnvelope(doc, effectiveLayout(ctx.layout), pages);
  const source = doc.meta.source;
  if (source && ctx.htmlDir !== null) {
    const mdPath = resolve2(ctx.imageBase, basename2(source));
    envelope.meta.source = relative(resolve2(ctx.htmlDir), mdPath).split(sep).join("/");
  }
  const lang = doc.meta.lang || "ja";
  const out = [head(ctx, title, needsFa, envelope, lang), "<body>"];
  pages.forEach((page, i) => out.push(renderPage(page, ctx, i + 1, pages.length, title, dateText2)));
  out.push(...tailScripts(needsShiki), pageNumberScript(), "</body></html>");
  return out[0] + "\n" + out.slice(1).join("\n");
}
function textWidth(columns, m) {
  if (columns === "two") return m.col2Px;
  if (columns === "split") return m.textColPx;
  return m.contentWPx;
}
function renderMeasureDocument(blocks, ctx, columns = ctx.metrics.columns) {
  const m = ctx.metrics;
  const [needsFa, needsShiki] = needs(blocks, null);
  const out = [head(ctx, "measure", needsFa, null, "ja"), "<body>"];
  const widths = [];
  if (columns === "two") widths.push(["col", m.col2Px, "col"]);
  else if (columns === "split") widths.push(["col", m.textColPx, "split"]);
  widths.push(["single", m.contentWPx, "single"]);
  for (const [name, width, figMode] of widths) {
    out.push(`<div class="measure" data-measure="${name}" style="width:${fixed(width, 2)}px">`);
    for (const b of blocks) out.push(renderBlock(b, ctx, figMode));
    out.push("</div>");
  }
  out.push(...tailScripts(needsShiki), "</body></html>");
  return out[0] + "\n" + out.slice(1).join("\n");
}

// src/mermaid.ts
var ID_PREFIX = "md2html-mermaid";
var DiagramError = class extends Error {
  cause;
  blockIds;
  constructor(cause, blockIds) {
    super(cause.message);
    this.cause = cause;
    this.blockIds = blockIds;
  }
  text() {
    const map = this.blockIds.map((id, i) => `  diagram ${i + 1} = block ${id}`).join("\n");
    return `${this.cause.text()}
Diagrams are the document's mermaid blocks, in order:
${map}`;
  }
};
var MERMAID_LAYOUTS = [
  "dagre",
  "swimlane",
  "cose-bilkent",
  "elk",
  "elk.stress",
  "elk.force",
  "elk.mrtree",
  "elk.sporeOverlap",
  "elk.box",
  "elk.rectpacking"
];
var FRONT_MATTER_RE = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
var DIRECTIVE_RE = /%%\{([\s\S]*?)\}%%/g;
var LAYOUT_KEY_RE = /["']?\b(layout|defaultRenderer)["']?\s*:\s*["']?([\w.-]+)/g;
var FLOWCHART_ELK_RE = /^\s*flowchart-elk\b/m;
function requestedLayouts(source) {
  const parts = [];
  const fm = FRONT_MATTER_RE.exec(source);
  if (fm) parts.push(fm[1]);
  for (const m of source.matchAll(DIRECTIVE_RE)) parts.push(m[1]);
  const names = [];
  for (const part of parts) for (const m of part.matchAll(LAYOUT_KEY_RE)) names.push(m[2]);
  const body = fm ? source.slice(fm[0].length) : source;
  if (FLOWCHART_ELK_RE.test(body.replace(DIRECTIVE_RE, ""))) names.push("elk");
  return names;
}
var LayoutRequestError = class extends Error {
};
function checkLayouts(blocks, mermaidVersion2) {
  const known = new Set(MERMAID_LAYOUTS);
  const bad = [];
  for (const b of blocks) {
    if (b.type !== "mermaid") continue;
    for (const name of requestedLayouts(b.source)) {
      if (!known.has(name)) bad.push(`block ${b.id} asks for layout '${name}'`);
    }
  }
  if (bad.length) {
    throw new LayoutRequestError(
      `${bad.join("; ")}, which Mermaid ${mermaidVersion2} does not have; Mermaid would draw it with dagre instead. Use one of: ${MERMAID_LAYOUTS.join(", ")}`
    );
  }
}
var Diagrams = class {
  renderer = null;
  /** source -> SVGs drawn for its occurrences, in document order */
  drawn = /* @__PURE__ */ new Map();
  browser;
  options;
  metrics;
  layout;
  constructor(browser, options, metrics, layout) {
    this.browser = browser;
    this.options = options;
    this.metrics = metrics;
    this.layout = layout;
  }
  /** The SVG for every mermaid block of `blocks` (block id -> SVG). `blocks` are in
   * document order; the n-th mermaid block is drawn with id md2html-mermaid-n. A
   * diagram is drawn again only when the set of diagrams changed. */
  async svgsFor(blocks) {
    const mermaid = blocks.filter((b) => b.type === "mermaid");
    const out = /* @__PURE__ */ new Map();
    if (!mermaid.length) return out;
    const needed = /* @__PURE__ */ new Map();
    for (const b of mermaid) needed.set(b.source, (needed.get(b.source) ?? 0) + 1);
    const sameSet = needed.size === this.drawn.size && [...needed].every(([src, n]) => (this.drawn.get(src)?.length ?? -1) === n);
    if (!sameSet) await this.draw(mermaid);
    const used = /* @__PURE__ */ new Map();
    for (const b of mermaid) {
      const k = used.get(b.source) ?? 0;
      used.set(b.source, k + 1);
      out.set(b.id, this.drawn.get(b.source)[k]);
    }
    return out;
  }
  async draw(mermaid) {
    if (this.renderer === null) {
      this.renderer = createRenderer({
        browser: this.browser.browser,
        iconsZip: this.options.iconsZip,
        css: this.options.fontCss,
        fontAwesome: this.options.fontAwesome
      });
    }
    checkLayouts(mermaid, mermaidVersion());
    let images;
    try {
      ;
      ({ images } = await this.renderer.render(
        mermaid.map((b) => b.source),
        { formats: ["svg"], idPrefix: ID_PREFIX, mermaidConfig: this.mermaidConfig() }
      ));
    } catch (e) {
      if (e instanceof BuildError) throw new DiagramError(e, mermaid.map((b) => b.id));
      throw e;
    }
    this.drawn = /* @__PURE__ */ new Map();
    mermaid.forEach((b, i) => {
      const svg = images[i]?.svg;
      if (svg === void 0) throw new Error(`internal: mermaid-arch returned no SVG for block ${b.id}`);
      const list2 = this.drawn.get(b.source) ?? [];
      list2.push(svg);
      this.drawn.set(b.source, list2);
    });
  }
  /** The look the Python version gave Mermaid in the page (theme "base", the body font
   * at 90% of the body size). The font list goes here, not into a diagram's
   * %%{init}%%: Mermaid drops a fontFamily with commas or quotes from there. */
  mermaidConfig() {
    return {
      theme: "base",
      securityLevel: "loose",
      themeVariables: {
        fontSize: mermaidFontSize(this.metrics),
        fontFamily: this.layout.fontFamily || DEFAULT_BODY_STACK
      }
    };
  }
  async close() {
    if (this.renderer !== null) await this.renderer.close();
    this.renderer = null;
  }
};

// src/paginate.ts
var MIN_TABLE_HEAD_ROWS = 3;
var MIN_CODE_LINES_TO_SPLIT = 16;
var MIN_CODE_SIDE_LINES = 3;
var MIN_PARAGRAPH_SIDE_LINES = 2;
var BlockHeight = class _BlockHeight {
  height;
  marginTop;
  marginBottom;
  lineHeight;
  lineOffsets;
  thead;
  rows;
  items;
  lines;
  padding;
  scale;
  intrinsicW;
  intrinsicH;
  split;
  constructor(init) {
    this.height = init.height;
    this.marginTop = init.marginTop ?? 0;
    this.marginBottom = init.marginBottom ?? 0;
    this.lineHeight = init.lineHeight ?? null;
    this.lineOffsets = init.lineOffsets ?? null;
    this.thead = init.thead ?? null;
    this.rows = init.rows ?? null;
    this.items = init.items ?? null;
    this.lines = init.lines ?? null;
    this.padding = init.padding ?? 0;
    this.scale = init.scale ?? null;
    this.intrinsicW = init.intrinsicW ?? 0;
    this.intrinsicH = init.intrinsicH ?? 0;
    this.split = init.split ?? 1;
  }
  get outer() {
    return this.marginTop + this.height + this.marginBottom;
  }
  static fromJs(e) {
    return new _BlockHeight({
      height: Number(e.height),
      marginTop: Number(e.marginTop ?? 0),
      marginBottom: Number(e.marginBottom ?? 0),
      lineHeight: e.lineHeight ?? null,
      lineOffsets: e.lineOffsets ?? null,
      thead: e.thead ?? null,
      rows: e.rows ?? null,
      items: e.items ?? null,
      lines: e.lines ?? null,
      padding: Number(e.padding ?? 0),
      scale: e.scale ?? null,
      intrinsicW: Number(e.intrinsicW || 0),
      intrinsicH: Number(e.intrinsicH || 0),
      split: Math.trunc(Number(e.split || 1))
    });
  }
};
var Accumulator = class {
  used = 0;
  lastMb = 0;
  count = 0;
  gapFor(h) {
    return this.count === 0 ? h.marginTop : Math.max(this.lastMb, h.marginTop);
  }
  needed(h) {
    return this.gapFor(h) + h.height + h.marginBottom;
  }
  remaining(capacity, h) {
    return capacity - this.used - this.gapFor(h);
  }
  add(h) {
    this.used += this.gapFor(h) + h.height;
    this.lastMb = h.marginBottom;
    this.count += 1;
  }
};
var Page = class {
  kind;
  title;
  continued;
  blocks = [];
  figure = null;
  id = null;
  col = new Accumulator();
  // text-column width accounting
  single = new Accumulator();
  // full-width accounting
  singleCommitted = false;
  // a block only fits at full width: no figure may join this page
  constructor(opts = {}) {
    this.kind = opts.kind ?? "content";
    this.title = opts.title ?? null;
    this.continued = opts.continued ?? false;
    if (opts.blocks) this.blocks = opts.blocks;
  }
  isEmpty() {
    return !this.blocks.length && this.figure === null;
  }
  get used() {
    return this.figure !== null ? this.col.used : this.single.used;
  }
  add(block, hCol, hSingle) {
    this.col.add(hCol);
    this.single.add(hSingle);
    this.blocks.push(block);
  }
  toJson() {
    let blocks = [...this.blocks];
    if (this.figure !== null) blocks = insertFigure(blocks, this.figure);
    return { id: this.id, kind: this.kind, title: this.title, continued: this.continued, blocks };
  }
};
function insertFigure(blocks, figure) {
  const order = figure._order;
  if (order === void 0 || order === null) return [...blocks, figure];
  const out = [];
  let placed = false;
  for (const b of blocks) {
    if (!placed && (b._order ?? -1) > order) {
      out.push(figure);
      placed = true;
    }
    out.push(b);
  }
  if (!placed) out.push(figure);
  return out;
}
function deepCopy(v) {
  return JSON.parse(JSON.stringify(v));
}
function stripOrder(b) {
  delete b._order;
}
function paginate(blocks, ctx, initialTitle = null, initialContinued = false) {
  if (ctx.columns === "two") return paginateTwoColumns(blocks, ctx, initialTitle, initialContinued);
  const pages = [];
  const queue = deepCopy(blocks);
  queue.forEach((b, i) => {
    if (!("_order" in b)) b._order = i;
  });
  let cur = new Page({ title: initialTitle, continued: initialContinued });
  const flush = () => {
    if (!cur.isEmpty()) pages.push(cur);
  };
  const continuation = () => new Page({ title: cur.title, continued: cur.title !== null || ctx.isSlide });
  while (queue.length) {
    const b = queue.shift();
    const t = b.type;
    if (t === "pagebreak") {
      flush();
      cur = new Page({ title: cur.title, continued: cur.title !== null });
      continue;
    }
    if (t === "heading" && b.level === 1) {
      if (ctx.isSlide) {
        flush();
        const cover = new Page({ kind: "cover", blocks: [b] });
        if (queue.length && queue[0].type === "paragraph") cover.blocks.push(queue.shift());
        pages.push(cover);
        cur = new Page({ title: ctx.docTitle, continued: false });
        continue;
      }
      if (!cur.isEmpty()) {
        flush();
        cur = new Page();
      }
    }
    if (t === "heading" && b.level === 2 && ctx.isSlide) {
      flush();
      cur = new Page({ title: b.text, continued: false });
      continue;
    }
    if (FIGURE_TYPES.has(t) && ctx.columns === "split") {
      if (cur.figure === null && !cur.singleCommitted) {
        cur.figure = b;
      } else {
        flush();
        cur = continuation();
        cur.figure = b;
      }
      continue;
    }
    const hCol = height(ctx.heights, b);
    const hSingle = height(ctx.heightsSingle, b);
    const keep = keepWithNext(ctx, b, queue);
    const withFigure = cur.figure !== null;
    const fitsCol = cur.col.used + cur.col.needed(hCol) + keep <= ctx.capacity;
    const fitsSingle = cur.single.used + cur.single.needed(hSingle) + keep <= ctx.capacity;
    if (withFigure && fitsCol || !withFigure && fitsSingle) {
      cur.add(b, hCol, hSingle);
      if (!withFigure && !fitsCol) cur.singleCommitted = true;
      continue;
    }
    const [acc, h] = withFigure ? [cur.col, hCol] : [cur.single, hSingle];
    const remaining = acc.remaining(ctx.capacity, h);
    const split = trySplit(ctx, b, h, remaining, cur.isEmpty());
    if (split !== null) {
      const [head2, headH, tail, tailH] = split;
      cur.add(head2, headH, headH);
      if (!withFigure) cur.singleCommitted = true;
      ctx.heights[tail.id] = tailH;
      ctx.heightsSingle[tail.id] = tailH;
      flush();
      cur = continuation();
      queue.unshift(tail);
      continue;
    }
    if (cur.isEmpty()) {
      const hard = ctx.capacity / SAFETY;
      if (acc.gapFor(h) + h.height > hard) {
        ctx.warnings.push(`block ${b.id ?? "None"} (${t}) is taller than a page; it will be clipped`);
      }
      cur.add(b, hCol, hSingle);
      continue;
    }
    queue.unshift(b);
    if (cur.blocks.length && cur.blocks[cur.blocks.length - 1].type === "heading" && cur.blocks.length > 1) {
      queue.unshift(cur.blocks.pop());
    }
    flush();
    cur = continuation();
  }
  flush();
  for (const p of pages) {
    p.blocks.forEach(stripOrder);
    if (p.figure !== null) stripOrder(p.figure);
  }
  return pages;
}
function height(heights, b) {
  const h = heights[b.id];
  if (h === void 0) throw new RangeError(`no measured height for block '${b.id}'`);
  return h;
}
function keepWithNext(ctx, b, queue) {
  if (b.type !== "heading") return 0;
  const lines = b.level <= 2 ? 3 : 2;
  if (queue.length) {
    const nxt = queue[0];
    const nid = nxt.id;
    if (FIGURE_TYPES.has(nxt.type)) {
      if (ctx.columns === "split") return 0;
      const table = ctx.columns === "two" ? ctx.heights : ctx.heightsSingle;
      const h = table[nid];
      if (h !== void 0) return h.marginTop + h.height + h.marginBottom;
    } else if (ctx.heights[nid] !== void 0) {
      return Math.min(ctx.heights[nid].height, lines * ctx.linePx);
    }
  }
  return lines * ctx.linePx;
}
var splitCounter = counter(1);
function tailId(b) {
  return `${b.id}.s${splitCounter()}`;
}
function trySplit(ctx, b, h, remaining, pageEmpty) {
  const t = b.type;
  const wholeFitsEmptyPage = h.marginTop + h.height + h.marginBottom <= ctx.capacity;
  if (t === "table" && h.rows?.length) return splitTable(b, h, remaining, wholeFitsEmptyPage, pageEmpty);
  if (t === "code" && h.lines?.length) return splitCode(b, h, remaining);
  if (t === "list" && h.items?.length) return splitList(b, h, remaining);
  if (t === "paragraph" && h.lineOffsets?.length && h.lineHeight) return splitParagraph(b, h, remaining);
  return null;
}
function sum(xs) {
  let s = 0;
  for (const x2 of xs) s += x2;
  return s;
}
function withKeys(b, kw) {
  return { ...b, ...kw };
}
function splitTable(b, h, remaining, wholeFits, pageEmpty) {
  const rows = h.rows ?? [];
  if (rows.length !== b.rows.length) return null;
  if (wholeFits && !pageEmpty) return null;
  const budget = remaining - (h.thead ?? 0) - h.marginBottom;
  let k = 0;
  let acc = 0;
  for (const r of rows) {
    if (acc + r > budget) break;
    acc += r;
    k += 1;
  }
  if (k < MIN_TABLE_HEAD_ROWS || k >= rows.length) return null;
  const head2 = withKeys(b, { rows: b.rows.slice(0, k) });
  const tail = withKeys(b, { rows: b.rows.slice(k), continued: true, id: tailId(b) });
  delete tail._order;
  const headH = new BlockHeight({ height: (h.thead ?? 0) + acc, marginTop: h.marginTop, marginBottom: h.marginBottom });
  const cap = (h.lineHeight || 0) * 0.8;
  const tailH = new BlockHeight({
    height: (h.thead ?? 0) + sum(rows.slice(k)) + cap,
    marginTop: h.marginTop,
    marginBottom: h.marginBottom,
    thead: h.thead,
    rows: rows.slice(k),
    lineHeight: h.lineHeight
  });
  return [head2, headH, tail, tailH];
}
function splitCode(b, h, remaining) {
  const lines = h.lines ?? [];
  if (lines.length !== b.lines.length || lines.length < MIN_CODE_LINES_TO_SPLIT) return null;
  const budget = remaining - h.padding - h.marginBottom;
  let k = 0;
  let acc = 0;
  for (const l of lines) {
    if (acc + l > budget) break;
    acc += l;
    k += 1;
  }
  if (k < MIN_CODE_SIDE_LINES || lines.length - k < MIN_CODE_SIDE_LINES) return null;
  const head2 = withKeys(b, { lines: b.lines.slice(0, k) });
  const tail = withKeys(b, { lines: b.lines.slice(k), continued: true, id: tailId(b) });
  delete tail._order;
  const note = lines[0];
  const headH = new BlockHeight({ height: h.padding + acc, marginTop: h.marginTop, marginBottom: h.marginBottom });
  const tailH = new BlockHeight({
    height: h.padding + sum(lines.slice(k)) + note,
    marginTop: h.marginTop,
    marginBottom: h.marginBottom,
    lines: lines.slice(k),
    padding: h.padding
  });
  return [head2, headH, tail, tailH];
}
function splitList(b, h, remaining) {
  const items = h.items ?? [];
  if (items.length !== b.items.length) return null;
  const budget = remaining - h.marginBottom;
  let k = 0;
  let acc = 0;
  for (const it of items) {
    if (acc + it > budget) break;
    acc += it;
    k += 1;
  }
  if (k < 1 || k >= items.length) return null;
  const head2 = withKeys(b, { items: b.items.slice(0, k) });
  const tail = withKeys(b, { items: b.items.slice(k), id: tailId(b) });
  if (b.ordered) tail.start = Math.trunc(b.start ?? 1) + k;
  delete tail._order;
  const headH = new BlockHeight({ height: acc, marginTop: h.marginTop, marginBottom: h.marginBottom });
  const tailH = new BlockHeight({ height: sum(items.slice(k)), marginTop: h.marginTop, marginBottom: h.marginBottom, items: items.slice(k) });
  return [head2, headH, tail, tailH];
}
function splitParagraph(b, h, remaining) {
  const offsets = h.lineOffsets ?? [0];
  const lh = h.lineHeight || 0;
  const n = offsets.length;
  const budget = remaining - h.marginBottom;
  const k = lh > 0 ? Math.floor(budget / lh) : 0;
  if (k < MIN_PARAGRAPH_SIDE_LINES || n - k < MIN_PARAGRAPH_SIDE_LINES) return null;
  const parts = splitInline(b.text, offsets[k]);
  if (parts === null) return null;
  const [headText, tailText] = parts;
  const head2 = withKeys(b, { text: headText });
  const tail = withKeys(b, { text: tailText, id: tailId(b) });
  delete tail._order;
  const headH = new BlockHeight({ height: k * lh, marginTop: h.marginTop, marginBottom: h.marginBottom });
  const tailH = new BlockHeight({
    height: (n - k) * lh,
    marginTop: h.marginTop,
    marginBottom: h.marginBottom,
    lineHeight: lh,
    lineOffsets: offsets.slice(k).map((o) => o - offsets[k])
  });
  return [head2, headH, tail, tailH];
}
function spillPages(pages, ctxForPage, existingIds) {
  const existing = new Set(existingIds ?? []);
  for (const p of pages) existing.add(p.id);
  const out = [];
  const spills = [];
  for (const page of pages) {
    if (page.kind === "source" || page.kind === "cover") {
      out.push(page);
      continue;
    }
    const ctx = ctxForPage(page);
    const result = paginate(page.blocks, ctx, page.title, page.continued);
    if (!result.length) {
      out.push(page);
      continue;
    }
    const first = result[0].toJson();
    first.id = page.id;
    first.kind = page.kind;
    first.continued = page.continued;
    out.push(first);
    let prevId = page.id;
    for (const extra of result.slice(1)) {
      const newId = uniqueId(page.id, existing);
      existing.add(newId);
      const j = extra.toJson();
      j.id = newId;
      j.kind = "content";
      out.push(j);
      spills.push({ source: prevId, target: newId, blocks: j.blocks.map((b) => b.id ?? "") });
      prevId = newId;
    }
  }
  return [out, spills];
}
function relayoutPages(current, needsRelayout, spill) {
  const existing = new Set(current.map((p) => p.id));
  const out = [];
  for (const page of current) {
    if (!needsRelayout(page)) {
      out.push(page);
      continue;
    }
    const [fixedPages] = spill([page], existing);
    for (const p of fixedPages) existing.add(p.id);
    out.push(...fixedPages);
  }
  return out;
}
function uniqueId(base, existing) {
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
var WIDE_TABLE_COLUMNS = 4;
var BALANCE_MIN_RATIO = 0.4;
function fitScale(box, w, h) {
  return Math.min(box[0] / w, box[1] / h, 1);
}
var Region = class {
  left = [];
  right = [];
  leftAcc = new Accumulator();
  rightAcc = new Accumulator();
  leftFull = false;
  isEmpty() {
    return !this.left.length && !this.right.length;
  }
  height() {
    const left = this.leftAcc.used + (this.left.length ? this.leftAcc.lastMb : 0);
    const right = this.rightAcc.used + (this.right.length ? this.rightAcc.lastMb : 0);
    return Math.max(left, right);
  }
};
var TwoColPage = class extends Page {
  segments = [];
  usedBefore = 0;
  // height of the closed segments
  region = null;
  isEmpty() {
    return !this.segments.length && (this.region === null || this.region.isEmpty());
  }
  /** Blocks are emitted in source order (a floated figure keeps its place in the
   * content); `_layout` records where each block was placed on the page. */
  toJson() {
    const segments = [...this.segments];
    if (this.region !== null && !this.region.isEmpty()) segments.push(["cols", this.region]);
    const tagged = [];
    segments.forEach((seg, s) => {
      if (seg[0] === "cols") {
        for (const b of seg[1].left) tagged.push([b, `cols:${s}:left`]);
        for (const b of seg[1].right) tagged.push([b, `cols:${s}:right`]);
      } else {
        tagged.push([seg[1], `wide:${s}`]);
      }
    });
    const orderOf = (b) => b._order === void 0 || b._order === null ? Infinity : b._order;
    tagged.sort((a, b) => orderOf(a[0]) - orderOf(b[0]) || 0);
    const blocks = tagged.map(([b]) => {
      const c = { ...b };
      delete c._order;
      return c;
    });
    const layout = [];
    segments.forEach((seg, s) => {
      if (seg[0] === "cols") {
        layout.push({
          kind: "cols",
          left: tagged.flatMap(([, tag], i) => tag === `cols:${s}:left` ? [i] : []),
          right: tagged.flatMap(([, tag], i) => tag === `cols:${s}:right` ? [i] : [])
        });
      } else {
        layout.push({ kind: "wide", index: tagged.findIndex(([, tag]) => tag === `wide:${s}`) });
      }
    });
    return { id: this.id, kind: this.kind, title: this.title, continued: this.continued, blocks, _layout: layout };
  }
};
function nextOrder(order) {
  const o = order === void 0 || order === null ? Infinity : Number(order);
  if (o === Infinity) return o;
  return o === Math.trunc(o) ? o + 0.5 : o + (Math.ceil(o) - o) / 2;
}
function isWide(block, ctx, queue = null) {
  const override = ctx.spanOverride[block.id ?? ""];
  if (override === 1 || override === 2) return override === 2;
  const t = block.type;
  if (t === "heading") {
    if (queue && queue.length && queue[0].type !== "heading") return isWide(queue[0], ctx, null);
    return false;
  }
  if (t === "table") return block.header.length >= WIDE_TABLE_COLUMNS;
  if (t === "html") return true;
  if (FIGURE_TYPES.has(t)) {
    const bid = block.id ?? "";
    const h = ctx.heights[bid];
    const hs = ctx.heightsSingle[bid];
    if (h && hs && h.scale !== null && hs.scale !== null) return hs.scale > h.scale;
    if (h && h.intrinsicW > 0 && h.intrinsicH > 0) {
      if (ctx.colBox === null || ctx.bandBox === null) {
        throw new RangeError("two-column pagination needs colBox and bandBox to place figures");
      }
      return fitScale(ctx.bandBox, h.intrinsicW, h.intrinsicH) > fitScale(ctx.colBox, h.intrinsicW, h.intrinsicH);
    }
    return false;
  }
  return false;
}
function paginateTwoColumns(blocks, ctx, initialTitle = null, initialContinued = false) {
  const pages = [];
  const queue = deepCopy(blocks);
  queue.forEach((b, i) => {
    if (!("_order" in b)) b._order = i;
  });
  let cur = new TwoColPage({ title: initialTitle, continued: initialContinued });
  const closeRegion = (balance) => {
    if (cur.region === null) return;
    if (cur.region.isEmpty()) {
      cur.region = null;
      return;
    }
    if (balance && cur.region.height() > BALANCE_MIN_RATIO * (ctx.capacity - cur.usedBefore)) {
      balanceRegion(cur.region, ctx);
    }
    cur.segments.push(["cols", cur.region]);
    cur.usedBefore += cur.region.height();
    cur.region = null;
  };
  const flush = () => {
    closeRegion(false);
    if (!cur.isEmpty()) pages.push(cur);
  };
  const continuation = () => new TwoColPage({ title: cur.title, continued: cur.title !== null || ctx.isSlide });
  const registerTail = (head2, tail, tailH) => {
    ctx.heights[tail.id] = tailH;
    ctx.heightsSingle[tail.id] = tailH;
    tail._order = nextOrder(head2._order);
  };
  while (queue.length) {
    const b = queue.shift();
    const t = b.type;
    if (t === "pagebreak") {
      flush();
      cur = new TwoColPage({ title: cur.title, continued: cur.title !== null });
      continue;
    }
    if (t === "heading" && b.level === 1) {
      if (ctx.isSlide) {
        flush();
        const cover = new Page({ kind: "cover", blocks: [b] });
        if (queue.length && queue[0].type === "paragraph") cover.blocks.push(queue.shift());
        pages.push(cover);
        cur = new TwoColPage({ title: ctx.docTitle, continued: false });
        continue;
      }
      if (!cur.isEmpty()) {
        flush();
        cur = new TwoColPage();
      }
    }
    if (t === "heading" && b.level === 2 && ctx.isSlide) {
      flush();
      cur = new TwoColPage({ title: b.text, continued: false });
      continue;
    }
    if (isWide(b, ctx, queue)) {
      closeRegion(true);
      const h2 = height(ctx.heightsSingle, b);
      const keep2 = keepWithNext(ctx, b, queue);
      if (cur.usedBefore + h2.outer + keep2 <= ctx.capacity) {
        cur.segments.push(["wide", b, h2]);
        cur.usedBefore += h2.outer;
        continue;
      }
      const remaining2 = ctx.capacity - cur.usedBefore - h2.marginTop;
      const split2 = trySplit(ctx, b, h2, remaining2, cur.isEmpty());
      if (split2 !== null) {
        const [head2, headH, tail, tailH] = split2;
        cur.segments.push(["wide", head2, headH]);
        cur.usedBefore += headH.outer;
        registerTail(head2, tail, tailH);
        flush();
        cur = continuation();
        queue.unshift(tail);
        continue;
      }
      if (cur.isEmpty()) {
        if (h2.marginTop + h2.height > ctx.capacity / SAFETY) {
          ctx.warnings.push(`block ${b.id ?? "None"} (${t}) is taller than a page; it will be clipped`);
        }
        cur.segments.push(["wide", b, h2]);
        cur.usedBefore += h2.outer;
        continue;
      }
      queue.unshift(b);
      const lastSeg = cur.segments[cur.segments.length - 1];
      if (lastSeg && lastSeg[0] === "wide" && lastSeg[1].type === "heading" && cur.segments.length > 1) {
        const heading = cur.segments.pop();
        cur.usedBefore -= heading[2].outer;
        queue.unshift(heading[1]);
      }
      flush();
      cur = continuation();
      continue;
    }
    if (cur.region === null) cur.region = new Region();
    const reg = cur.region;
    const limit = ctx.capacity - cur.usedBefore;
    const h = height(ctx.heights, b);
    const keep = keepWithNext(ctx, b, queue);
    const [colBlocks, acc] = reg.leftFull ? [reg.right, reg.rightAcc] : [reg.left, reg.leftAcc];
    if (acc.used + acc.needed(h) + keep <= limit) {
      colBlocks.push(b);
      acc.add(h);
      continue;
    }
    if (FIGURE_TYPES.has(t) && !reg.leftFull && !reg.right.length && reg.rightAcc.needed(h) <= limit) {
      reg.right.push(b);
      reg.rightAcc.add(h);
      continue;
    }
    const remaining = acc.remaining(limit, h);
    const split = trySplit(ctx, b, h, remaining, acc.count === 0);
    if (split !== null) {
      const [head2, headH, tail, tailH] = split;
      colBlocks.push(head2);
      acc.add(headH);
      registerTail(head2, tail, tailH);
      queue.unshift(tail);
      if (!reg.leftFull) {
        reg.leftFull = true;
      } else {
        flush();
        cur = continuation();
      }
      continue;
    }
    if (acc.count === 0 && cur.usedBefore === 0) {
      if (acc.gapFor(h) + h.height > limit / SAFETY) {
        ctx.warnings.push(`block ${b.id ?? "None"} (${t}) is taller than a column; it will be clipped`);
      }
      colBlocks.push(b);
      acc.add(h);
      continue;
    }
    queue.unshift(b);
    if (colBlocks.length && colBlocks[colBlocks.length - 1].type === "heading" && colBlocks.length > 1) {
      queue.unshift(colBlocks.pop());
      rebuildAccumulator(acc, colBlocks, ctx.heights);
    }
    if (!reg.leftFull && acc.count > 0) {
      reg.leftFull = true;
    } else {
      flush();
      cur = continuation();
    }
  }
  flush();
  for (const p of pages) p.blocks.forEach(stripOrder);
  return pages;
}
function rebuildAccumulator(acc, blocks, heights) {
  acc.used = 0;
  acc.lastMb = 0;
  acc.count = 0;
  for (const b of blocks) acc.add(heights[b.id]);
}
function balanceRegion(reg, ctx) {
  const orderOf = (b) => b._order === void 0 || b._order === null ? Infinity : b._order;
  const blocks = [...reg.left, ...reg.right].sort((a, b) => orderOf(a) - orderOf(b) || 0);
  const total = new Accumulator();
  for (const b of blocks) total.add(ctx.heights[b.id]);
  const target = (total.used + total.lastMb) / 2;
  let left = [];
  let right = [];
  let lacc = new Accumulator();
  for (const b of blocks) {
    if (right.length) {
      right.push(b);
      continue;
    }
    const h = ctx.heights[b.id];
    if (lacc.used + lacc.needed(h) <= target) {
      left.push(b);
      lacc.add(h);
      continue;
    }
    if (!left.length) {
      left.push(b);
      lacc.add(h);
    } else {
      right.push(b);
    }
  }
  if (right.length && left.length && left[left.length - 1].type === "heading") {
    if (left.length === 1) return;
    right = [left.pop(), ...right];
  }
  lacc = new Accumulator();
  const racc = new Accumulator();
  rebuildAccumulator(lacc, left, ctx.heights);
  rebuildAccumulator(racc, right, ctx.heights);
  const newHeight = Math.max(lacc.used + (left.length ? lacc.lastMb : 0), racc.used + (right.length ? racc.lastMb : 0));
  if (newHeight > reg.height() + 0.5) {
    return;
  }
  reg.left = left;
  reg.right = right;
  reg.leftAcc = lacc;
  reg.rightAcc = racc;
  reg.leftFull = true;
}
function flattenWithSettings(pages, settingsOf) {
  const blocks = [];
  const settings = [];
  let prevKind = null;
  for (const page of pages) {
    if (page.kind === "source") continue;
    const s = settingsOf(page);
    if (page.kind === "content" && page.title && !page.continued && prevKind !== "cover") {
      blocks.push({ type: "heading", level: 2, text: page.title });
      settings.push(s);
    }
    prevKind = page.kind;
    for (const b of page.blocks) {
      const prev = blocks[blocks.length - 1];
      if (b.continued && prev && prev.type === b.type) {
        if (b.type === "table") {
          prev.rows = [...prev.rows, ...b.rows];
          continue;
        }
        if (b.type === "code") {
          prev.lines = [...prev.lines, ...b.lines];
          continue;
        }
      }
      const nb = { ...b };
      delete nb.continued;
      blocks.push(nb);
      settings.push(s);
    }
  }
  return { blocks, settings };
}

// src/pptx.ts
import { mkdirSync, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname3 } from "node:path";
import { zipSync } from "fflate";
var MM_TO_EMU = 36e3;
var PT_PER_MM = 72 / 25.4;
var PAGES_JS = String.raw`
(withText) => Array.from(document.querySelectorAll('section.page')).map(sec => {
  const R = sec.getBoundingClientRect();
  const rel = (r) => [(r.left - R.left) / R.width, (r.top - R.top) / R.height, r.width / R.width, r.height / R.height];
  const links = [];
  for (const a of sec.querySelectorAll('a[href]')) {
    for (const r of a.getClientRects()) {
      if (r.width > 0 && r.height > 0) { links.push({ href: a.href, rect: rel(r) }); }
    }
  }
  const lines = [];
  if (withText) {
    const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text.trim()) { continue; }
      const p = node.parentElement;
      if (!p || p.closest('svg, script, style')) { continue; }
      const cs = getComputedStyle(p);
      if (cs.visibility === 'hidden' || cs.display === 'none') { continue; }
      const size = parseFloat(cs.fontSize);
      let cur = null, lastTop = null;
      for (let i = 0; i < text.length; i++) {
        const rg = document.createRange();
        rg.setStart(node, i); rg.setEnd(node, i + 1);
        const rects = rg.getClientRects();
        if (!rects.length) { continue; }
        const rc = rects[0];
        if (rc.width === 0 && text[i] === '\n') { continue; }
        if (cur === null || Math.abs(rc.top - lastTop) > 1) {
          if (cur !== null) { lines.push(cur); }
          cur = { text: '', left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom, size };
          lastTop = rc.top;
        }
        cur.text += text[i];
        cur.left = Math.min(cur.left, rc.left); cur.right = Math.max(cur.right, rc.right);
        cur.top = Math.min(cur.top, rc.top); cur.bottom = Math.max(cur.bottom, rc.bottom);
      }
      if (cur !== null) { lines.push(cur); }
    }
  }
  return {
    id: sec.dataset.pageId,
    links,
    lines: lines.filter(l => l.text.trim()).map(l => ({
      text: l.text, size: l.size / R.height,
      rect: rel({ left: l.left, top: l.top, width: l.right - l.left, height: l.bottom - l.top })
    }))
  };
})
`;
async function capturePages(browser, htmlPath, opts) {
  const page = await browser.open(htmlPath, opts.dpi / 96);
  try {
    const meta = await call(page, PAGES_JS, opts.textLayer);
    const sections = await page.$$("section.page");
    if (sections.length !== meta.length) throw new Error("page count mismatch while capturing slides");
    const out = [];
    for (let i = 0; i < sections.length; i++) {
      const image = opts.imageFormat === "png" ? await sections[i].screenshot({ type: "png" }) : await sections[i].screenshot({ type: "jpeg", quality: opts.jpegQuality });
      out.push({ ...meta[i], image, imageFormat: opts.imageFormat });
    }
    return out;
  } finally {
    await page.close();
  }
}
var NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
var NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
function x(s) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function rels(items) {
  const body = items.map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith("http") ? r.type : `${REL}/${r.type}`}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("");
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}
var THEME = `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
var EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
var MASTER = `${XML_HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
var LAYOUT = `${XML_HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
function xfrm(x0, y0, cx, cy) {
  return `<a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
}
function assemblePptx(slides, widthMm, heightMm, pptxPath, opts) {
  const slideW = Math.round(widthMm * MM_TO_EMU);
  const slideH = Math.round(heightMm * MM_TO_EMU);
  const pageHPt = heightMm * PT_PER_MM;
  const box = ([fx, fy, fw, fh]) => [
    Math.trunc(fx * slideW),
    Math.trunc(fy * slideH),
    Math.max(1, Math.trunc(fw * slideW)),
    Math.max(1, Math.trunc(fh * slideH))
  ];
  const files = {};
  const enc = new TextEncoder();
  const put = (name, text) => {
    files[name] = enc.encode(text);
  };
  let nLinks = 0;
  let nLines = 0;
  const exts = /* @__PURE__ */ new Set();
  slides.forEach((s, idx) => {
    const n = idx + 1;
    const ext = s.imageFormat === "png" ? "png" : "jpeg";
    exts.add(ext);
    files[`ppt/media/image${n}.${ext}`] = s.image;
    const slideRels = [
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "image", target: `../media/image${n}.${ext}` }
    ];
    let shapeId = 2;
    const shapes = [
      `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId++}" name="Picture 1"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(0, 0, slideW, slideH)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    ];
    if (opts.textLayer) {
      for (const ln of s.lines) {
        const [bx, by, bw, bh] = box(ln.rect);
        const sz = Math.round(Math.max(1, ln.size * pageHPt) * 100);
        const id = shapeId++;
        shapes.push(
          `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(bx, by, bw, bh)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="ja-JP" sz="${sz}" noProof="1"><a:solidFill><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:rPr><a:t>${x(ln.text)}</a:t></a:r></a:p></p:txBody></p:sp>`
        );
        nLines++;
      }
    }
    if (opts.linkHotspots) {
      for (const lk of s.links) {
        const [bx, by, bw, bh] = box(lk.rect);
        const rid = `rId${slideRels.length + 1}`;
        slideRels.push({ id: rid, type: "hyperlink", target: lk.href, external: true });
        const id = shapeId++;
        shapes.push(
          `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rectangle ${id - 1}"><a:hlinkClick r:id="${rid}"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(bx, by, bw, bh)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst/></p:spPr></p:sp>`
        );
        nLinks++;
      }
    }
    put(
      `ppt/slides/slide${n}.xml`,
      `${XML_HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${EMPTY_TREE}${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    );
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels));
  });
  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  put(
    "ppt/presentation.xml",
    `${XML_HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` + (slides.length ? `<p:sldIdLst>${slideIds}</p:sldIdLst>` : "") + `<p:sldSz cx="${slideW}" cy="${slideH}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
  );
  const presRels = [
    { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    ...slides.map((_, i) => ({ id: `rId${i + 2}`, type: "slide", target: `slides/slide${i + 1}.xml` }))
  ];
  const n0 = slides.length + 2;
  presRels.push(
    { id: `rId${n0}`, type: "presProps", target: "presProps.xml" },
    { id: `rId${n0 + 1}`, type: "viewProps", target: "viewProps.xml" },
    { id: `rId${n0 + 2}`, type: "theme", target: "theme/theme1.xml" },
    { id: `rId${n0 + 3}`, type: "tableStyles", target: "tableStyles.xml" }
  );
  put("ppt/_rels/presentation.xml.rels", rels(presRels));
  put("ppt/presProps.xml", `${XML_HEAD}<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`);
  put("ppt/viewProps.xml", `${XML_HEAD}<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`);
  put("ppt/tableStyles.xml", `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  put("ppt/theme/theme1.xml", THEME);
  put("ppt/slideMasters/slideMaster1.xml", MASTER);
  put(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" }
    ])
  );
  put("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]));
  put(
    "docProps/app.xml",
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>gospelo-md2html</Application></Properties>`
  );
  put(
    "docProps/core.xml",
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>gospelo-md2html</dc:creator></cp:coreProperties>`
  );
  put(
    "_rels/.rels",
    rels([
      { id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
      { id: "rId2", type: "extended-properties", target: "docProps/app.xml" },
      {
        id: "rId3",
        type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        target: "docProps/core.xml"
      }
    ])
  );
  const pres = "application/vnd.openxmlformats-officedocument.presentationml";
  const overrides = [
    ["/ppt/presentation.xml", `${pres}.presentation.main+xml`],
    ["/ppt/presProps.xml", `${pres}.presProps+xml`],
    ["/ppt/viewProps.xml", `${pres}.viewProps+xml`],
    ["/ppt/tableStyles.xml", `${pres}.tableStyles+xml`],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/ppt/slideMasters/slideMaster1.xml", `${pres}.slideMaster+xml`],
    ["/ppt/slideLayouts/slideLayout1.xml", `${pres}.slideLayout+xml`],
    ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
    ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
    ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, `${pres}.slide+xml`])
  ];
  const defaults = [
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["xml", "application/xml"],
    ...[...exts].map((e) => [e, e === "png" ? "image/png" : "image/jpeg"])
  ];
  put(
    "[Content_Types].xml",
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` + defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join("") + overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join("") + "</Types>"
  );
  const ordered = { "[Content_Types].xml": files["[Content_Types].xml"] };
  for (const [k, v] of Object.entries(files)) if (k !== "[Content_Types].xml") ordered[k] = v;
  mkdirSync(dirname3(pptxPath), { recursive: true });
  writeFileSync3(pptxPath, zipSync(ordered, { level: 6, mtime: /* @__PURE__ */ new Date("2000-01-01T00:00:00Z") }));
  return { slides: slides.length, links: nLinks, textLines: nLines };
}
async function exportPptx(browser, htmlPath, pptxPath, widthMm, heightMm, opts) {
  return assemblePptx(await capturePages(browser, htmlPath, opts), widthMm, heightMm, pptxPath, opts);
}

// src/sections.ts
var KEYS = {
  columns: "columns",
  "split-ratio": "splitRatio",
  gutter: "gutter",
  "figure-side": "figureSide"
};
function parseLayoutComment(body, where) {
  const settings = {};
  const words2 = strip(body).split(/\s+/).filter(Boolean);
  if (!words2.length) throw new LayoutError(`${where}: the layout comment sets nothing (expected e.g. columns=single)`);
  for (const word of words2) {
    const m = /^([a-z-]+)=(\S+)$/.exec(word);
    if (!m) throw new LayoutError(`${where}: ${repr(word)} in the layout comment is not key=value`);
    const key = KEYS[m[1]];
    if (key === void 0) {
      throw new LayoutError(`${where}: unknown key ${repr(m[1])} in the layout comment (expected ${Object.keys(KEYS).join(", ")})`);
    }
    if (key in settings) throw new LayoutError(`${where}: ${repr(m[1])} is set twice in the layout comment`);
    settings[key] = key === "splitRatio" ? Number(m[2]) : m[2];
  }
  validateOverrides({ [where]: settings }, "the Markdown");
  return settings;
}
function sectionSettings(blocks) {
  const out = [];
  const settings = [];
  const open = [];
  let lastWasMarker = false;
  for (const b of blocks) {
    if (b.type === "layout") {
      const prev = out[out.length - 1];
      if (!prev || prev.type !== "heading" || lastWasMarker) {
        const after = lastWasMarker ? "another layout comment" : prev ? `a ${prev.type} block` : "the start of the document";
        throw new LayoutError(`a layout comment must come right after a heading, one per heading (found after ${after})`);
      }
      const s = parseLayoutComment(b.settings, `heading ${repr(prev.text)}`);
      open.push({ level: prev.level, settings: s });
      settings[settings.length - 1] = s;
      lastWasMarker = true;
      continue;
    }
    lastWasMarker = false;
    if (b.type === "heading") {
      while (open.length && open[open.length - 1].level >= b.level) open.pop();
    }
    if ((b.type === "paragraph" || b.type === "quote") && /<!--\s*layout:/.test(b.text)) {
      throw new LayoutError(
        `a layout comment inside a paragraph is ignored by Markdown; put it on its own line right after a heading: ${repr(b.text.slice(0, 60))}`
      );
    }
    out.push(b);
    settings.push(open.length ? open[open.length - 1].settings : null);
  }
  return { blocks: out, settings };
}
function settingsKey(s) {
  if (s === null) return "";
  return JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]));
}
function runs(blocks, settings) {
  const out = [];
  blocks.forEach((b, i) => {
    const s = settings[i] ?? null;
    const last = out[out.length - 1];
    if (last && settingsKey(last.settings) === settingsKey(s)) last.blocks.push(b);
    else out.push({ blocks: [b], settings: s });
  });
  return out;
}
var PAGE_ID_RE = /^p\d+(?:-\d+)*$/;
function remapPageOverrides(overrides, pageIds) {
  const out = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!PAGE_ID_RE.test(key)) out[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!PAGE_ID_RE.test(key)) continue;
    const to = pageIds.get(key);
    if (to !== void 0) out[to] = { ...out[to] ?? {}, ...value };
  }
  return out;
}

// src/report.ts
import { writeFileSync as writeFileSync4 } from "node:fs";
function buildReport(metrics, columns, verify, spills, warnings, notes) {
  const pages = verify.map((p) => {
    const remaining = Math.max(0, p.contentHeightPx - p.usedPx);
    const entry = {
      id: p.id,
      layoutMode: p.mode,
      usedPx: p.usedPx,
      remainingPx: remaining,
      remainingLines: Math.floor(remaining / metrics.linePx),
      overflowPx: p.overflowPx,
      figure: p.figure ?? null,
      blocks: p.blocks,
      warnings: []
    };
    if (p.titleTruncated) entry.warnings.push("header title truncated");
    if (p.figureOverflowPx) entry.warnings.push(`figure column overflows by ${p.figureOverflowPx}px`);
    const fig = p.figure;
    if (fig && fig.scale !== void 0 && fig.scale !== null && fig.scale < 0.5) {
      entry.warnings.push(`figure ${fig.id} scaled to ${fixed(fig.scale, 2)}; text may be too small`);
    }
    for (const b of p.blocks) {
      if (b.scale !== void 0 && b.scale !== null && b.scale < 0.5) {
        entry.warnings.push(`figure ${b.id} scaled to ${fixed(b.scale, 2)}; text may be too small`);
      }
    }
    return entry;
  });
  const report = {
    layout: {
      page: metrics.fmt.id,
      fontSizePx: pyRound(metrics.F, 2),
      columns,
      contentHeightPx: pyRound(metrics.contentHPx),
      contentWidthPx: pyRound(metrics.contentWPx),
      textColumnWidthPx: columns === "split" ? pyRound(metrics.textColPx) : pyRound(metrics.contentWPx),
      lineHeightPx: pyRound(metrics.linePx, 2)
    },
    pageCount: pages.length,
    pages,
    spills,
    warnings
  };
  if (notes) report.import = notes;
  return report;
}
function writeReport(report, path) {
  writeFileSync4(path, jsonDumps(report) + "\n", "utf-8");
}
var padEnd = (s, n) => s.padEnd(n);
var padStart = (s, n) => String(s).padStart(n);
function printSummary(report, label) {
  const lay = report.layout;
  console.log(`[${label}] ${lay.page} font ${lay.fontSizePx}px columns=${lay.columns} pages=${report.pageCount}`);
  for (const p of report.pages) {
    let line = `  ${padEnd(p.id, 8)} ${padEnd(p.layoutMode, 12)} used ${padStart(p.usedPx, 5)}px  remaining ${padStart(p.remainingPx, 5)}px (${p.remainingLines} lines)`;
    if (p.overflowPx) line += `  OVERFLOW ${p.overflowPx}px`;
    console.log(line);
    for (const w of p.warnings) console.log(`           warning: ${w}`);
  }
  for (const s of report.spills) console.log(`  spill: ${s.from} -> ${s.to} blocks=${s.blocks.join(",")}`);
  for (const w of report.warnings) console.log(`  warning: ${w}`);
  const imp = report.import;
  if (imp) {
    for (const [k, v] of Object.entries(imp)) {
      const empty = v === 0 || Array.isArray(v) && v.length === 0;
      if (!empty) console.log(`  import ${k}: ${Array.isArray(v) ? pyList(v) : v}`);
    }
  }
}
function pyList(items) {
  return "[" + items.map((s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(", ") + "]";
}

// src/cli.ts
var EXIT_OK = 0;
var EXIT_ERROR = 1;
var EXIT_USAGE = 2;
var EXIT_NOT_CONVERGED = 2;
var MAX_VERIFY_ROUNDS = 3;
var verifySplitCounter = counter(1);
var CliError = class extends Error {
};
var UsageError = class extends Error {
};
var LAYOUT_OPTS = {
  layout: { type: "string", help: "layout JSON (CLI options win)", metavar: "FILE" },
  page: { type: "string", choices: PAGE_IDS, help: "page format" },
  "font-size": { type: "string", help: "body font size: 11pt / 14px / 3.5mm" },
  "font-family": { type: "string", help: `CSS font-family list for body text, e.g. "'Noto Sans JP', sans-serif" (default: base.css stack)` },
  "code-font-family": { type: "string", help: "CSS font-family list for code and inline code (default: base.css stack)" },
  "no-embed-fonts": { type: "boolean", help: "do not embed subsets of the vendored BIZ UD fonts (the viewer's own fonts are used)" },
  "title-scale": { type: "string", help: "title size as a multiple of the body size", metavar: "FLOAT" },
  "header-title": { type: "string", help: "section | doc | fixed:<text>" },
  columns: { type: "string", choices: ["two", "split", "single"], help: "two = two columns, left then right (default on landscape paper), split = one figure beside the text, single" },
  "figure-side": { type: "string", choices: ["left", "right"], help: "side of the figure column in split pages" },
  "split-ratio": { type: "string", help: "text column fraction in split pages (0.4 to 0.6)", metavar: "FLOAT" },
  gutter: {
    type: "string",
    metavar: "LENGTH",
    help: "gap between columns (split and two): em (x body font size), px, mm or pt (default 2em)"
  },
  details: { type: "string", choices: ["drop", "expand"], help: "what to do with <details> blocks" },
  "mermaid-lib": {
    type: "string",
    choices: ["prerender"],
    help: "prerender = diagrams written as SVG (the only mode; embed and link are no longer supported)"
  },
  "mermaid-version": {
    type: "string",
    metavar: "X.Y.Z",
    help: "accept the Mermaid version mermaid-arch draws with, for a document paginated with another one"
  },
  "hr-break": { type: "boolean", help: "a horizontal rule starts a new page" },
  "image-scale": { type: "string", help: "image pixels per CSS px", metavar: "FLOAT" },
  "embed-images": { type: "boolean", help: "embed images as data: URIs" },
  date: { type: "string", help: "YYYY-MM-DD or none" },
  css: { type: "string", help: "extra CSS file", metavar: "FILE" }
};
var DRAW_OPTS = {
  "icons-zip": {
    type: "string",
    metavar: "ZIP",
    help: "AWS Architecture Icons package (Icon-package_*.zip); required when diagrams use aws: icons"
  },
  chrome: {
    type: "string",
    metavar: "PATH",
    help: "chrome-headless-shell executable (default: $CHROME_PATH, $PUPPETEER_EXECUTABLE_PATH, then puppeteer's cache)"
  }
};
var REPORT_OPTS = {
  report: { type: "string", help: "write the report JSON here", metavar: "FILE" },
  verbose: { type: "boolean", help: "print measured heights and verify rounds" }
};
var COMMANDS = {
  setup: { help: "install the npm packages and chrome-headless-shell (first run only)", positional: [], opts: {} },
  import: {
    help: "Markdown -> Gospelo Document (.gospelo.html, paginated and verified)",
    positional: ["input"],
    opts: {
      output: { type: "string", short: "o", metavar: "PATH", help: "output path: <name>.gospelo.html (default: next to the input) or a <name>.gospelo.json sidecar" },
      force: { type: "boolean", help: "overwrite an existing output" },
      "dry-run": { type: "boolean", help: "do everything but write the output" },
      ...REPORT_OPTS,
      ...DRAW_OPTS,
      ...LAYOUT_OPTS
    }
  },
  check: {
    help: "verify a Gospelo Document and report capacity (writes nothing)",
    positional: ["content"],
    opts: { ...REPORT_OPTS, ...DRAW_OPTS, ...LAYOUT_OPTS }
  },
  build: {
    help: "Gospelo Document -> rebuilt .gospelo.html (and PDF / PPTX)",
    positional: ["content"],
    opts: {
      output: { type: "string", short: "o", metavar: "PATH", help: "HTML path (default: the input HTML, or <name>.gospelo.html next to a JSON)" },
      pdf: { type: "string", metavar: "PATH", help: "also write a PDF" },
      pptx: { type: "string", metavar: "PATH", help: "also write a PPTX: one image slide per page, links as invisible hotspots" },
      "pptx-dpi": { type: "string", metavar: "INT", help: "slide image resolution (default 200)" },
      "pptx-image": { type: "string", choices: ["jpg", "png"], help: "slide image format (default jpg; png is crisper but larger)" },
      "pptx-text": { type: "boolean", help: "add a transparent selectable-text layer over each slide (some viewers show it as faint doubled text)" },
      "pptx-no-links": { type: "boolean", help: "skip the link hotspots" },
      reflow: { type: "boolean", help: "re-paginate everything (HTML input: rebuild in place; JSON input: rewrite the JSON and exit)" },
      "no-write-back": { type: "boolean", help: "do not write auto spills back to a JSON input" },
      ...REPORT_OPTS,
      ...DRAW_OPTS,
      ...LAYOUT_OPTS
    }
  },
  restore: {
    help: "write the original Markdown from page 0 of a Gospelo Document",
    positional: ["source"],
    opts: { output: { type: "string", short: "o", metavar: "PATH", help: "Markdown path to write" } },
    required: ["output"]
  }
};
function usage(command) {
  if (command === void 0) {
    const lines2 = Object.entries(COMMANDS).map(([name, c2]) => `  ${name.padEnd(8)} ${c2.help}`);
    return `usage: md2html <command> [options]

gospelo-md2html ${VERSION}: Markdown + Mermaid -> paginated HTML / PDF / PPTX

commands:
${lines2.join("\n")}

Run md2html <command> --help for the options of a command.`;
  }
  const c = COMMANDS[command];
  const pos = c.positional.map((p) => p.toUpperCase()).join(" ");
  const lines = Object.entries(c.opts).map(([name, o]) => {
    const flag2 = (o.short ? `-${o.short}, ` : "") + `--${name}` + (o.type === "string" ? ` ${o.choices ? `{${o.choices.join(",")}}` : o.metavar ?? name.toUpperCase().replace(/-/g, "_")}` : "");
    return `  ${flag2}
      ${o.help}`;
  });
  return `usage: md2html ${command} ${pos} [options]

${c.help}

options:
${lines.join("\n")}`;
}
function parse(argv) {
  const [command, ...rest] = argv;
  if (command === void 0 || command === "-h" || command === "--help") {
    console.log(usage());
    process.exit(command === void 0 ? EXIT_USAGE : EXIT_OK);
  }
  if (command === "--version") {
    console.log(VERSION);
    process.exit(EXIT_OK);
  }
  const c = COMMANDS[command];
  if (!c) throw new UsageError(`unknown command '${command}' (choose from ${Object.keys(COMMANDS).join(", ")})`);
  if (command === "setup" && rest.some((a) => a === "--elk" || a === "--elk-only")) {
    throw new UsageError(
      "setup --elk / --elk-only is no longer needed: Mermaid 12 includes the ELK layout. Run setup without options"
    );
  }
  if (rest.includes("-h") || rest.includes("--help")) {
    console.log(usage(command));
    process.exit(EXIT_OK);
  }
  const options = {};
  for (const [name, o] of Object.entries(c.opts)) options[name] = { type: o.type, ...o.short ? { short: o.short } : {} };
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new UsageError(e.message);
  }
  if (parsed.positionals.length !== c.positional.length) {
    throw new UsageError(`${command} takes ${c.positional.length ? c.positional.map((p) => p.toUpperCase()).join(" ") : "no arguments"}`);
  }
  const args = { command };
  c.positional.forEach((p, i) => args[p] = parsed.positionals[i]);
  for (const [name, o] of Object.entries(c.opts)) {
    const v = parsed.values[name];
    if (typeof v === "string" && o.choices && !o.choices.includes(v)) {
      throw new UsageError(`argument --${name}: invalid choice: '${v}' (choose from ${o.choices.join(", ")})`);
    }
    args[name] = v;
  }
  for (const r of c.required ?? []) if (args[r] === void 0) throw new UsageError(`the following arguments are required: --${r}`);
  return args;
}
function floatArg(args, name) {
  const v = args[name];
  if (v === void 0) return void 0;
  const n = Number(v);
  if (typeof v !== "string" || v.trim() === "" || !Number.isFinite(n)) throw new UsageError(`argument --${name}: invalid float value: '${v}'`);
  return n;
}
function intArg(args, name, dflt) {
  const v = args[name];
  if (v === void 0) return dflt;
  if (typeof v !== "string" || !/^[+-]?\d+$/.test(v.trim())) throw new UsageError(`argument --${name}: invalid int value: '${v}'`);
  return parseInt(v, 10);
}
var str = (args, name) => args[name];
var flag = (args, name) => args[name] === true;
function layoutFromArgs(args, base = null) {
  const cli = {
    page: str(args, "page"),
    fontSize: str(args, "font-size"),
    fontFamily: str(args, "font-family"),
    codeFontFamily: str(args, "code-font-family"),
    embedFonts: flag(args, "no-embed-fonts") ? false : void 0,
    titleScale: floatArg(args, "title-scale"),
    headerTitle: str(args, "header-title"),
    columns: str(args, "columns"),
    figureSide: str(args, "figure-side"),
    splitRatio: floatArg(args, "split-ratio"),
    gutter: str(args, "gutter"),
    details: str(args, "details"),
    mermaidLib: str(args, "mermaid-lib"),
    mermaidVersion: str(args, "mermaid-version"),
    hrBreak: flag(args, "hr-break") ? true : void 0,
    imageScale: floatArg(args, "image-scale"),
    embedImages: flag(args, "embed-images") ? true : void 0,
    date: str(args, "date"),
    css: str(args, "css")
  };
  return buildLayout(str(args, "layout") ?? null, cli, base, mermaidVersion());
}
function metricsFromLayout(layout) {
  return buildMetrics(
    getFormat(layout.page),
    layout.fontSize,
    layout.titleScale,
    layout.columns,
    layout.figureSide,
    layout.splitRatio,
    layout.gutter
  );
}
function today() {
  const d = /* @__PURE__ */ new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateText(layout, docDate) {
  if (layout.date === "none") return null;
  if (layout.date) return layout.date;
  if (docDate) return docDate;
  return today();
}
async function openSession(args, layout, metrics, imageBase, fontCss2, allBlocks) {
  const iconsZip = str(args, "icons-zip") ?? null;
  if (iconsZip !== null && !(existsSync4(iconsZip) && statSync3(iconsZip).isFile())) {
    throw new CliError(`--icons-zip: no such file: ${iconsZip}`);
  }
  const browser = await Browser.launch(str(args, "chrome") ?? null);
  const diagrams = new Diagrams(browser, { iconsZip, fontCss: fontCss2, fontAwesome: needsFontAwesome(allBlocks) }, metrics, layout);
  return { browser, diagrams, metrics, layout, imageBase, fontCss: fontCss2 };
}
async function closeSession(s) {
  try {
    await s.diagrams.close();
  } finally {
    await s.browser.close();
  }
}
async function withSession(s, fn) {
  try {
    return await fn(s);
  } finally {
    await closeSession(s);
  }
}
function renderContext(s, htmlDir, svgs, metrics = s.metrics) {
  return {
    metrics,
    layout: s.layout,
    imageBase: s.imageBase,
    htmlDir,
    embedImages: htmlDir !== null && s.layout.embedImages,
    svgs,
    codeHtml: null,
    fontCss: s.fontCss
  };
}
function tempHtml(dir, prefix) {
  return join4(dir, `.md2html-${prefix}-${randomBytes(6).toString("hex")}.html`);
}
function writeTemp(path, text) {
  writeFileSync5(path, text, { encoding: "utf-8", flag: "wx" });
}
async function measureHeights(s, blocks, workDir, metrics = s.metrics, columns = metrics.columns) {
  const ctx = renderContext(s, null, await s.diagrams.svgsFor(blocks), metrics);
  const htmlText = renderMeasureDocument(blocks, ctx, columns);
  const path = tempHtml(workDir, "measure");
  let raw;
  try {
    writeTemp(path, htmlText);
    raw = await measureDocument(s.browser, path);
  } finally {
    if (process.env.MD2HTML_KEEP_TEMP !== "1") unlinkSync(path);
  }
  if (!raw.single) throw new CliError("measurement returned no single-width heights");
  const toHeights = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, BlockHeight.fromJs(v)]));
  const single = toHeights(raw.single);
  const col = raw.col ? toHeights(raw.col) : single;
  const missing = blocks.filter((b) => !(b.id in single) && b.type !== "pagebreak").map((b) => b.id);
  if (missing.length) throw new CliError(`measurement returned no height for blocks: ${missing.join(", ")}`);
  return [col, single];
}
function makePaginateCtx(metrics, columns, heightsCol, heightsSingle, docTitle, layout) {
  const heights = columns === "split" || columns === "two" ? heightsCol : heightsSingle;
  const [colW, colH, colR] = metrics.figureBox("col");
  const [bandW, bandH, bandR] = metrics.figureBox("single");
  return {
    isSlide: metrics.fmt.isSlide,
    columns,
    capacity: metrics.contentHPx * SAFETY,
    linePx: metrics.linePx,
    heights: { ...heights },
    heightsSingle: { ...heightsSingle },
    docTitle,
    warnings: [],
    spanOverride: layout ? layout.spanOverrides() : {},
    colBox: [colW, colH * colR],
    bandBox: [bandW, bandH * bandR]
  };
}
async function paginateRuns(s, blocks, settings, docTitle, workDir, verbose) {
  const warnings = [];
  const [heightsCol, heightsSingle] = await measureHeights(s, blocks, workDir);
  if (verbose) printVerboseHeights(heightsCol);
  const docKey = `${s.metrics.columns}:${fixed(textWidth(s.metrics.columns, s.metrics), 3)}`;
  const tables = /* @__PURE__ */ new Map([[docKey, heightsCol]]);
  const plan = runs(blocks, settings).map((run) => {
    const metrics = run.settings ? overrideMetrics(run.settings, s.metrics) : s.metrics;
    const columns = run.settings?.columns ?? s.metrics.columns;
    return { ...run, metrics, columns, key: `${columns}:${fixed(textWidth(columns, metrics), 3)}` };
  });
  for (const run of plan) {
    if (run.columns === "single" || tables.has(run.key)) continue;
    const same = plan.filter((r) => r.key === run.key).flatMap((r) => r.blocks);
    const [col] = await measureHeights(s, same, workDir, run.metrics, run.columns);
    tables.set(run.key, col);
  }
  const pages = [];
  const pageSettings = [];
  for (const run of plan) {
    const col = run.columns === "single" ? heightsSingle : tables.get(run.key);
    const ctx = makePaginateCtx(run.metrics, run.columns, col, heightsSingle, docTitle, s.layout);
    ctx.warnings = warnings;
    const last = pages[pages.length - 1];
    const out = paginate(run.blocks, ctx, last ? last.title : null, last ? last.title !== null : false).map((p) => p.toJson());
    pages.push(...out);
    pageSettings.push(...out.map(() => run.settings));
  }
  assignPageIds(pages);
  pages.forEach((p, i) => {
    const ps = pageSettings[i];
    if (ps) s.layout.overrides[p.id] = { ...ps, ...s.layout.overrides[p.id] ?? {} };
  });
  return { pages, warnings };
}
function assignPageIds(pages, start = 1) {
  pages.forEach((p, i) => p.id = `p${String(i + start).padStart(2, "0")}`);
}
async function verifyAndFix(s, doc, pagesIn, htmlDir, date, workDir, verbose, relayout) {
  let pages = pagesIn;
  let rounds = 0;
  const keep = process.env.MD2HTML_KEEP_TEMP === "1";
  for (; ; ) {
    const ctx = renderContext(s, htmlDir, await s.diagrams.svgsFor(pages.flatMap((p) => p.blocks)));
    let htmlText = renderDocument(doc, pages, ctx, date);
    const path = tempHtml(workDir, "verify");
    let verify;
    let codeHtml;
    try {
      writeTemp(path, htmlText);
      [verify, codeHtml] = await verifyDocument(s.browser, path);
    } finally {
      if (!keep) unlinkSync(path);
    }
    const overflowing = verify.filter((v) => v.overflowPx > 0 && v.mode !== "cover");
    if (!overflowing.length) {
      if (Object.keys(codeHtml).length) ctx.codeHtml = codeHtml;
      htmlText = renderDocument(doc, pages, ctx, date);
      return [htmlText, verify, rounds, pages, ctx.codeHtml];
    }
    rounds += 1;
    if (verbose) {
      for (const v of overflowing) {
        const ids = v.blocks.map((b) => b.id).join(",");
        console.error(`  verify round ${rounds}: ${v.id} overflow ${v.overflowPx}px used ${v.usedPx}/${v.contentHeightPx} blocks=${ids}`);
      }
      if (keep) console.error(`  kept ${path}`);
    }
    if (rounds > MAX_VERIFY_ROUNDS) {
      throw new CliError(
        `verification did not converge after ${MAX_VERIFY_ROUNDS} rounds; overflowing pages: ${overflowing.map((v) => v.id).join(", ")}`
      );
    }
    pages = pushLastBlocks(pages, new Map(overflowing.map((v) => [v.id, v])), s.layout);
    if (relayout !== null) pages = relayout(pages);
  }
}
function pushLastBlocks(pages, overflowing, layout) {
  const out = [];
  const existing = new Set(pages.map((p) => p.id));
  for (const page of pages) {
    const v = overflowing.get(page.id);
    if (v === void 0) {
      out.push(page);
      continue;
    }
    const fig = String(v.mode ?? "").startsWith("split") ? firstFigure(page) : null;
    const textBlocks = page.blocks.filter((b) => b !== fig);
    if (!textBlocks.length) {
      out.push(page);
      continue;
    }
    let moved;
    let keep;
    if (textBlocks.length === 1) {
      const split = splitByVerify(textBlocks[0], v);
      if (split === null) {
        out.push(page);
        continue;
      }
      const [headB, tailB] = split;
      keep = page.blocks.map((b) => b === textBlocks[0] ? headB : b);
      moved = tailB;
    } else {
      moved = textBlocks[textBlocks.length - 1];
      keep = page.blocks.filter((b) => b !== moved);
    }
    let n = 2;
    while (existing.has(`${page.id}-${n}`)) n += 1;
    const newId = `${page.id}-${n}`;
    existing.add(newId);
    inheritPageOverride(layout, page.id, newId);
    const shrunk = { ...page, blocks: keep };
    delete shrunk._layout;
    out.push(shrunk);
    out.push({ id: newId, kind: "content", title: page.title, continued: page.title !== null, blocks: [moved] });
  }
  return out;
}
function splitByVerify(block, v) {
  const info = v.blocks.find((b) => b.id === block.id);
  if (info === void 0) return null;
  const overflow = v.overflowPx + 1;
  const t = block.type;
  const tailId2 = `${block.id}.v${verifySplitCounter()}`;
  const cutFrom = (heights) => {
    let cut = heights.length;
    let removed = 0;
    while (cut > 1 && removed < overflow) {
      cut -= 1;
      removed += heights[cut];
    }
    return cut;
  };
  if (t === "table" && info.rowHeightsPx?.length && block.rows.length > 1) {
    const cut = cutFrom(info.rowHeightsPx);
    if (cut < 1 || cut >= block.rows.length) return null;
    return [{ ...block, rows: block.rows.slice(0, cut) }, { ...block, rows: block.rows.slice(cut), continued: true, id: tailId2 }];
  }
  if (t === "list" && info.itemHeightsPx?.length && block.items.length > 1) {
    const cut = cutFrom(info.itemHeightsPx);
    if (cut < 1 || cut >= block.items.length) return null;
    const tail = { ...block, items: block.items.slice(cut), id: tailId2 };
    if (block.ordered) tail.start = Math.trunc(block.start ?? 1) + cut;
    return [{ ...block, items: block.items.slice(0, cut) }, tail];
  }
  if (t === "code" && info.lineHeightPx && block.lines.length > 1) {
    const lh = info.lineHeightPx;
    const nRemove = Math.floor(overflow / lh) + 1;
    const cut = block.lines.length - nRemove;
    if (cut < 1) return null;
    return [{ ...block, lines: block.lines.slice(0, cut) }, { ...block, lines: block.lines.slice(cut), continued: true, id: tailId2 }];
  }
  return null;
}
function resolveImageBase(contentPath, doc) {
  const src = doc.meta.source;
  if (src) return resolve3(dirname4(contentPath), dirname4(src));
  return resolve3(dirname4(contentPath));
}
function printVerboseHeights(heights) {
  for (const [k, v] of Object.entries(heights)) {
    console.error(
      `    ${k.padEnd(12)} ${fixed(v.height, 1).padStart(7)}px  mt ${fixed(v.marginTop, 0).padStart(4)} mb ${fixed(v.marginBottom, 0).padStart(4)}`
    );
  }
}
function relPath(target, fromDir) {
  return relative2(resolve3(fromDir), resolve3(target)).split(sep2).join("/");
}
var SKILL_DIR2 = SKILL_DIR;
async function cmdSetup() {
  try {
    const found2 = resolveChrome(null);
    console.log(`chrome-headless-shell: ${found2.path} (from ${found2.source})`);
    return EXIT_OK;
  } catch (e) {
    if (!(e instanceof BuildError2) || e.code !== "chrome-missing") throw e;
  }
  const cache = puppeteerCacheDir();
  console.log(`Installing chrome-headless-shell ${SHELL_VERSION} into ${cache} ...`);
  const r = spawnSync("npx", ["--no-install", "@puppeteer/browsers", "install", `chrome-headless-shell@${SHELL_VERSION}`, "--path", cache], {
    cwd: SKILL_DIR2,
    stdio: "inherit"
  });
  if (r.status !== 0) throw new CliError(`installing chrome-headless-shell ${SHELL_VERSION} failed`);
  const found = resolveChrome(null);
  console.log(`chrome-headless-shell: ${found.path} (from ${found.source})`);
  return EXIT_OK;
}
async function fontCss(doc, layout, blocks) {
  const pages = contentPages(doc);
  const bl = blocks ?? pages.flatMap((p) => p.blocks);
  const titles = [doc.meta.title, ...pages.filter((p) => p.title).map((p) => p.title)];
  if (layout.headerTitle.startsWith("fixed:")) titles.push(layout.headerTitle.slice("fixed:".length));
  return embeddedFontCss(bl, titles, layout);
}
function dropRuntimeKeys(pages) {
  for (const p of pages) {
    for (const key of Object.keys(p)) if (key.startsWith("_")) delete p[key];
    for (const b of p.blocks) {
      delete b.id;
      delete b._generated_id;
    }
  }
}
function remapIds(text, idMap) {
  return text.replace(/\b(?:p\d+(?:-\d+)*-)?b\d+(?:\.[sv]?\d+)*\b/g, (m) => idMap.get(m) ?? m);
}
async function cmdImport(args) {
  const src = str(args, "input");
  if (!existsSync4(src) || !statSync3(src).isFile()) throw new CliError(`input not found: ${src}`);
  const outPath = str(args, "output") ?? defaultHtmlPath(src);
  const toHtml = isHtmlPath(outPath);
  if (!toHtml && extname3(outPath).toLowerCase() !== ".json") {
    throw new CliError(`output must end in .html (Gospelo Document) or .json (sidecar): ${outPath}`);
  }
  const dryRun = flag(args, "dry-run");
  const verbose = flag(args, "verbose");
  if (existsSync4(outPath) && !flag(args, "force") && !dryRun) {
    throw new CliError(`${outPath} already exists; pass --force to overwrite (this discards edits)`);
  }
  const layout = layoutFromArgs(args);
  const metrics = metricsFromLayout(layout);
  const original = readFileSync6(src, "utf-8");
  const notes = new ImportNotes();
  const text = preprocessMarkdown(original, layout.details, notes);
  const { blocks: blockList, settings: blockSettings } = sectionSettings(parseBlocks(text, layout.hrBreak, notes));
  if (!blockList.length) throw new CliError("no content blocks found in the Markdown");
  blockList.forEach((b, i) => b.id = `b${i}`);
  const stem = basename3(src, extname3(src));
  const title = docTitleFromBlocks(blockList, stem);
  const date = dateText(layout, null);
  const doc = {
    version: SCHEMA_VERSION,
    meta: { title, date, source: relPath(src, dirname4(resolve3(outPath))) },
    pages: [makeSourcePage(original)]
  };
  const imageBase = dirname4(resolve3(src));
  const workDir = dirname4(resolve3(outPath));
  mkdirSync2(workDir, { recursive: true });
  const css = await fontCss(doc, layout, blockList);
  const session = await openSession(args, layout, metrics, imageBase, css, blockList);
  const { finalPages, verify, rounds, warnings, htmlText, oldIds } = await withSession(session, async (s) => {
    const { pages: firstPass } = await paginateRuns(s, blockList, blockSettings, title, workDir, verbose);
    dropRuntimeKeys(firstPass);
    doc.pages.push(...firstPass);
    validateContent(doc, outPath);
    assignBlockIds(doc);
    const [pages, , warnings2, relayout] = await buildPages(s, doc, workDir, verbose);
    const [, verify2, rounds2, finalPages2, codeHtml] = await verifyAndFix(s, doc, pages, workDir, date, workDir, verbose, relayout);
    const oldIds2 = finalPages2.map((p) => p.blocks.map((b) => b.id));
    const oldPageIds = finalPages2.map((p) => p.id);
    assignPageIds(finalPages2);
    layout.overrides = remapPageOverrides(layout.overrides, new Map(oldPageIds.map((id, i) => [id, finalPages2[i].id])));
    let htmlText2 = null;
    if (toHtml) {
      const ctx = renderContext(s, workDir, await s.diagrams.svgsFor(finalPages2.flatMap((p) => p.blocks)));
      ctx.codeHtml = codeHtml;
      htmlText2 = renderDocument(doc, finalPages2, ctx, date);
    }
    return { finalPages: finalPages2, verify: verify2, rounds: rounds2, warnings: warnings2, htmlText: htmlText2, oldIds: oldIds2 };
  });
  dropRuntimeKeys(finalPages);
  doc.pages = [doc.pages[0], ...finalPages];
  assignBlockIds(doc);
  const idMap = /* @__PURE__ */ new Map();
  finalPages.forEach(
    (p, i) => p.blocks.forEach((b, j) => {
      const old = oldIds[i][j];
      if (old) idMap.set(old, b.id);
    })
  );
  verify.forEach((v, i) => {
    v.id = finalPages[i].id;
    for (const b of v.blocks) b.id = idMap.get(b.id) ?? b.id;
    if (v.figure) v.figure.id = idMap.get(v.figure.id) ?? v.figure.id;
  });
  const warningsOut = warnings.map((w) => remapIds(w, idMap));
  const report = buildReport(metrics, metrics.columns, verify, [], warningsOut, notes.toDict());
  report.verifyRounds = rounds;
  printSummary(report, dryRun ? "import (dry-run)" : "import");
  const reportPath = str(args, "report");
  if (reportPath) writeReport(report, reportPath);
  if (dryRun) {
    console.log(`dry run: ${outPath} not written`);
    return EXIT_OK;
  }
  if (toHtml) writeFileSync5(outPath, htmlText, "utf-8");
  else saveDocument(doc, effectiveLayout(layout), outPath);
  console.log(`wrote ${outPath}`);
  return EXIT_OK;
}
function prepareBuild(args) {
  const contentPath = str(args, "content");
  const [doc, embeddedLayout] = loadDocument(contentPath);
  const layout = layoutFromArgs(args, embeddedLayout);
  const metrics = metricsFromLayout(layout);
  return [contentPath, doc, layout, metrics, resolveImageBase(contentPath, doc)];
}
async function buildPages(s, doc, workDir, verbose) {
  const pages = contentPages(doc);
  const allBlocks = pages.flatMap((p) => p.blocks);
  const [heightsCol, heightsSingle] = await measureHeights(s, allBlocks, workDir);
  if (verbose) printVerboseHeights(heightsCol);
  const warnings = [];
  const probe = { layout: s.layout, metrics: s.metrics };
  const columnsForPage = (page) => {
    const mode = pageMode(page, probe);
    if (mode === "two") return "two";
    return mode === "single" ? "single" : "split";
  };
  const widthKey = (columns, m) => `${columns}:${fixed(textWidth(columns, m), 3)}`;
  const tables = /* @__PURE__ */ new Map([[widthKey(s.metrics.columns, s.metrics), heightsCol]]);
  const colTable = (page) => {
    const columns = columnsForPage(page);
    if (columns === "single") return heightsSingle;
    const table = tables.get(widthKey(columns, pageMetrics(page.id, probe)));
    if (table === void 0) throw new CliError(`internal: no heights measured for the columns of page ${page.id}`);
    return table;
  };
  const groups = /* @__PURE__ */ new Map();
  for (const page of pages) {
    const columns = columnsForPage(page);
    if (page.kind !== "content" || columns === "single") continue;
    const pm = pageMetrics(page.id, probe);
    const key = widthKey(columns, pm);
    if (tables.has(key)) continue;
    const g = groups.get(key) ?? { columns, metrics: pm, blocks: [] };
    g.blocks.push(...page.blocks);
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const [col] = await measureHeights(s, g.blocks, workDir, g.metrics, g.columns);
    tables.set(key, col);
  }
  const ctxForPage = (page) => {
    const ctx = makePaginateCtx(pageMetrics(page.id, probe), columnsForPage(page), colTable(page), heightsSingle, doc.meta.title, s.layout);
    ctx.warnings = warnings;
    return ctx;
  };
  const spill = (pgs, existing) => {
    const [out, sp] = spillPages(pgs, ctxForPage, existing);
    for (const x2 of sp) inheritPageOverride(s.layout, x2.source, x2.target);
    return [out, sp];
  };
  const [newPages, spills] = spill(pages);
  const needsRelayout = (p) => p.kind === "content" && !("_layout" in p) && columnsForPage(p) === "two" && p.blocks.every((b) => b.id in colTable(p));
  const relayout = (current) => relayoutPages(current, needsRelayout, spill);
  return [newPages, spills, warnings, relayout];
}
function inheritPageOverride(layout, from, to) {
  const ov = layout.pageOverride(from);
  if (!Object.keys(ov).length) return;
  layout.overrides[to] = { ...ov, ...layout.overrides[to] ?? {} };
}
function spillEntries(spills) {
  return spills.map((sp) => ({ from: sp.source, to: sp.target, blocks: sp.blocks }));
}
async function cmdCheck(args) {
  const [contentPath, doc, layout, metrics, imageBase] = prepareBuild(args);
  const verbose = flag(args, "verbose");
  const workDir = dirname4(resolve3(contentPath));
  const date = dateText(layout, doc.meta.date);
  const css = await fontCss(doc, layout);
  const session = await openSession(args, layout, metrics, imageBase, css, contentPages(doc).flatMap((p) => p.blocks));
  const [spills, warnings, verify, rounds] = await withSession(session, async (s) => {
    const [pages, spills2, warnings2, relayout] = await buildPages(s, doc, workDir, verbose);
    const [, verify2, rounds2] = await verifyAndFix(s, doc, pages, workDir, date, workDir, verbose, relayout);
    return [spills2, warnings2, verify2, rounds2];
  });
  const report = buildReport(metrics, metrics.columns, verify, spillEntries(spills), warnings);
  report.verifyRounds = rounds;
  printSummary(report, "check");
  const reportPath = str(args, "report");
  if (reportPath) writeReport(report, reportPath);
  return EXIT_OK;
}
async function cmdBuild(args) {
  let [contentPath, doc, layout, metrics, imageBase] = prepareBuild(args);
  const verbose = flag(args, "verbose");
  const fromHtml = isHtmlPath(contentPath);
  const outPath = str(args, "output") ?? (fromHtml ? contentPath : defaultHtmlPath(contentPath));
  const outDir = dirname4(resolve3(outPath));
  mkdirSync2(outDir, { recursive: true });
  const date = dateText(layout, doc.meta.date);
  if (flag(args, "reflow")) {
    if (!fromHtml) return cmdReflow(args, contentPath, doc, layout, metrics, imageBase);
    const [reflowed, reflowWarnings] = await reflowDoc(args, doc, layout, metrics, imageBase, outDir);
    doc = reflowed;
    console.log(`reflowed ${contentPath}: ${contentPages(doc).length} pages; rebuilding the HTML`);
    for (const w of reflowWarnings) console.log(`  warning: ${w}`);
  }
  const css = await fontCss(doc, layout);
  const session = await openSession(args, layout, metrics, imageBase, css, contentPages(doc).flatMap((p) => p.blocks));
  const [pages, spills, warnings, verify, rounds, finalPages] = await withSession(session, async (s) => {
    const [pages2, spills2, warnings2, relayout] = await buildPages(s, doc, outDir, verbose);
    const [htmlText, verify2, rounds2, finalPages2] = await verifyAndFix(s, doc, pages2, outDir, date, outDir, verbose, relayout);
    writeFileSync5(outPath, htmlText, "utf-8");
    console.log(`wrote ${outPath}`);
    const pdf = str(args, "pdf");
    if (pdf) {
      await s.browser.exportPdf(outPath, pdf);
      console.log(`wrote ${pdf}`);
    }
    const pptx = str(args, "pptx");
    if (pptx) {
      const opts = {
        dpi: intArg(args, "pptx-dpi", 200),
        imageFormat: str(args, "pptx-image") === "png" ? "png" : "jpeg",
        jpegQuality: 92,
        textLayer: flag(args, "pptx-text"),
        linkHotspots: !flag(args, "pptx-no-links")
      };
      const counts = await exportPptx(s.browser, outPath, pptx, metrics.fmt.widthMm, metrics.fmt.heightMm, opts);
      console.log(
        `wrote ${pptx} (${counts.slides} slides, ${counts.links} links` + (opts.textLayer ? `, ${counts.textLines} text lines` : "") + ")"
      );
    }
    return [pages2, spills2, warnings2, verify2, rounds2, finalPages2];
  });
  const before = new Set(pages.map((p) => p.id));
  const pushed = finalPages.filter((p) => !before.has(p.id));
  const changed = spills.length > 0 || pushed.length > 0 || rounds > 0;
  if (changed && !flag(args, "no-write-back")) {
    if (fromHtml) {
      console.log(`auto spill applied; the updated pages are embedded in ${outPath}`);
    } else {
      doc.pages = [...doc.pages[0].kind === "source" ? [doc.pages[0]] : [], ...finalPages];
      saveDocument(doc, effectiveLayout(layout), contentPath);
      console.log(`wrote back ${contentPath} (auto spill)`);
    }
  }
  const report = buildReport(metrics, metrics.columns, verify, spillEntries(spills), warnings);
  report.verifyRounds = rounds;
  printSummary(report, "build");
  const reportPath = str(args, "report");
  if (reportPath) writeReport(report, reportPath);
  return EXIT_OK;
}
async function reflowDoc(args, doc, layout, metrics, imageBase, workDir) {
  const { blocks: flat, settings } = flattenWithSettings(doc.pages, (page) => {
    const ov = layout.pageOverride(page.id);
    return Object.keys(ov).length ? ov : null;
  });
  for (const key of Object.keys(layout.overrides)) if (PAGE_ID_RE.test(key)) delete layout.overrides[key];
  flat.forEach((b, i) => b.id = `b${i}`);
  const css = await fontCss(doc, layout, flat);
  const session = await openSession(args, layout, metrics, imageBase, css, flat);
  const { pages, warnings } = await withSession(session, (s) => paginateRuns(s, flat, settings, doc.meta.title, workDir, false));
  for (const p of pages) for (const b of p.blocks) delete b.id;
  const head2 = doc.pages[0].kind === "source" ? [doc.pages[0]] : [];
  doc.pages = [...head2, ...pages];
  validateContent(doc, "reflow");
  assignBlockIds(doc);
  return [doc, warnings];
}
async function cmdReflow(args, contentPath, doc, layout, metrics, imageBase) {
  const [reflowed, warnings] = await reflowDoc(args, doc, layout, metrics, imageBase, dirname4(resolve3(contentPath)));
  saveDocument(reflowed, effectiveLayout(layout), contentPath);
  console.log(`reflowed ${contentPath}: ${contentPages(reflowed).length} pages (no HTML written; run build next)`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  return EXIT_OK;
}
function cmdRestore(args) {
  const text = restoreMarkdown(str(args, "source"));
  const out = str(args, "output");
  writeFileSync5(out, text, "utf-8");
  console.log(`wrote ${out}`);
  return EXIT_OK;
}
async function main(argv) {
  let args;
  try {
    args = parse(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${usage(COMMANDS[argv[0] ?? ""] ? argv[0] : void 0).split("\n")[0]}
md2html: error: ${e.message}`);
    return EXIT_USAGE;
  }
  try {
    switch (args.command) {
      case "setup":
        return await cmdSetup();
      case "import":
        return await cmdImport(args);
      case "check":
        return await cmdCheck(args);
      case "build":
        return await cmdBuild(args);
      case "restore":
        return cmdRestore(args);
    }
    return EXIT_USAGE;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${usage(args.command).split("\n")[0]}
md2html: error: ${e.message}`);
      return EXIT_USAGE;
    }
    if (e instanceof DiagramError || e instanceof BuildError2) {
      console.error(`error: ${e.text()}`);
      return EXIT_ERROR;
    }
    if (e instanceof CliError || e instanceof LayoutError || e instanceof ContentError || e instanceof AssetError || e instanceof MeasureError || e instanceof RenderError || e instanceof LayoutRequestError || e instanceof RangeError) {
      console.error(`error: ${e.message}`);
      return e.message.includes("did not converge") ? EXIT_NOT_CONVERGED : EXIT_ERROR;
    }
    throw e;
  }
}
var exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
export {
  main
};
