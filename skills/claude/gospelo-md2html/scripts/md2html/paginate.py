"""Pagination and overflow spilling (docs/04_layout_logic.md section 4,
docs/07_content_model.md section 5.1). Pure functions over measured heights.
"""

from __future__ import annotations

import copy
import itertools
import math
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .content import FIGURE_TYPES
from .inline import split_inline
from .scale import SAFETY

MIN_TABLE_HEAD_ROWS = 3
MIN_CODE_LINES_TO_SPLIT = 16
MIN_CODE_SIDE_LINES = 3
MIN_PARAGRAPH_SIDE_LINES = 2


@dataclass
class BlockHeight:
    height: float
    margin_top: float = 0.0
    margin_bottom: float = 0.0
    line_height: float | None = None
    line_offsets: list[int] | None = None
    thead: float | None = None
    rows: list[float] | None = None
    items: list[float] | None = None
    lines: list[float] | None = None
    padding: float = 0.0
    scale: float | None = None
    intrinsic_w: float = 0.0
    intrinsic_h: float = 0.0

    @property
    def outer(self) -> float:
        return self.margin_top + self.height + self.margin_bottom

    @classmethod
    def from_js(cls, e: dict[str, Any]) -> "BlockHeight":
        return cls(
            height=float(e["height"]), margin_top=float(e.get("marginTop", 0)), margin_bottom=float(e.get("marginBottom", 0)),
            line_height=e.get("lineHeight"), line_offsets=e.get("lineOffsets"), thead=e.get("thead"),
            rows=e.get("rows"), items=e.get("items"), lines=e.get("lines"), padding=float(e.get("padding", 0)),
            scale=e.get("scale"), intrinsic_w=float(e.get("intrinsicW", 0) or 0), intrinsic_h=float(e.get("intrinsicH", 0) or 0),
        )


@dataclass
class Accumulator:
    """Running height of one column width."""
    used: float = 0.0
    last_mb: float = 0.0
    count: int = 0

    def gap_for(self, h: BlockHeight) -> float:
        return h.margin_top if self.count == 0 else max(self.last_mb, h.margin_top)

    def needed(self, h: BlockHeight) -> float:
        return self.gap_for(h) + h.height + h.margin_bottom

    def remaining(self, capacity: float, h: BlockHeight) -> float:
        return capacity - self.used - self.gap_for(h)

    def add(self, h: BlockHeight) -> None:
        self.used += self.gap_for(h) + h.height
        self.last_mb = h.margin_bottom
        self.count += 1


@dataclass
class Page:
    kind: str = "content"
    title: str | None = None
    continued: bool = False
    blocks: list[dict[str, Any]] = field(default_factory=list)
    figure: dict[str, Any] | None = None
    id: str | None = None
    col: Accumulator = field(default_factory=Accumulator)      # text-column width accounting
    single: Accumulator = field(default_factory=Accumulator)   # full-width accounting
    single_committed: bool = False  # a block only fits at full width: no figure may join this page

    def is_empty(self) -> bool:
        return not self.blocks and self.figure is None

    @property
    def used(self) -> float:
        return self.col.used if self.figure is not None else self.single.used

    def add(self, block: dict[str, Any], h_col: BlockHeight, h_single: BlockHeight) -> None:
        self.col.add(h_col)
        self.single.add(h_single)
        self.blocks.append(block)

    def to_json(self) -> dict[str, Any]:
        blocks = list(self.blocks)
        if self.figure is not None:
            blocks = _insert_figure(blocks, self.figure)
        return {"id": self.id, "kind": self.kind, "title": self.title, "continued": self.continued, "blocks": blocks}


def _insert_figure(blocks: list[dict[str, Any]], figure: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep source order: the figure goes back where it was relative to the text."""
    order = figure.get("_order")
    if order is None:
        return blocks + [figure]
    out = []
    placed = False
    for b in blocks:
        if not placed and b.get("_order", -1) > order:
            out.append(figure)
            placed = True
        out.append(b)
    if not placed:
        out.append(figure)
    return out


@dataclass
class PaginateContext:
    is_slide: bool
    columns: str                            # "two" | "split" | "single"
    capacity: float                         # content height x SAFETY
    line_px: float
    heights: dict[str, BlockHeight]         # measured at column width
    heights_single: dict[str, BlockHeight]  # measured at full content width
    doc_title: str
    warnings: list[str] = field(default_factory=list)
    span_override: dict[str, int] = field(default_factory=dict)  # block id -> 1 | 2 (layout overrides)
    # figure boxes (width, max height) in px for the two-column layout: a column and a full-width band
    col_box: tuple[float, float] | None = None
    band_box: tuple[float, float] | None = None


def paginate(blocks: list[dict[str, Any]], ctx: PaginateContext,
             initial_title: str | None = None, initial_continued: bool = False) -> list[Page]:
    if ctx.columns == "two":
        return paginate_two_columns(blocks, ctx, initial_title, initial_continued)
    pages: list[Page] = []
    queue: deque[dict[str, Any]] = deque(copy.deepcopy(blocks))
    for i, b in enumerate(queue):
        b.setdefault("_order", i)
    cur = Page(title=initial_title, continued=initial_continued)

    def flush() -> None:
        nonlocal cur
        if not cur.is_empty():
            pages.append(cur)

    def continuation() -> Page:
        return Page(title=cur.title, continued=cur.title is not None or ctx.is_slide)

    while queue:
        b = queue.popleft()
        t = b["type"]
        if t == "pagebreak":
            flush()
            cur = Page(title=cur.title, continued=cur.title is not None)
            continue
        if t == "heading" and b["level"] == 1:
            if ctx.is_slide:
                flush()
                cover = Page(kind="cover", blocks=[b])
                if queue and queue[0]["type"] == "paragraph":
                    cover.blocks.append(queue.popleft())
                pages.append(cover)
                cur = Page(title=ctx.doc_title, continued=False)
                continue
            if not cur.is_empty():
                flush()
                cur = Page()
        if t == "heading" and b["level"] == 2 and ctx.is_slide:
            flush()
            cur = Page(title=b["text"], continued=False)
            continue
        if t in FIGURE_TYPES and ctx.columns == "split":
            if cur.figure is None and not cur.single_committed:
                cur.figure = b
            else:
                flush()
                cur = continuation()
                cur.figure = b
            continue

        h_col = _height(ctx.heights, b)
        h_single = _height(ctx.heights_single, b)
        keep = _keep_with_next(ctx, b, queue)
        with_figure = cur.figure is not None
        fits_col = cur.col.used + cur.col.needed(h_col) + keep <= ctx.capacity
        fits_single = cur.single.used + cur.single.needed(h_single) + keep <= ctx.capacity
        if (with_figure and fits_col) or (not with_figure and fits_single):
            cur.add(b, h_col, h_single)
            if not with_figure and not fits_col:
                cur.single_committed = True
            continue

        acc, h = (cur.col, h_col) if with_figure else (cur.single, h_single)
        remaining = acc.remaining(ctx.capacity, h)
        split = _try_split(ctx, b, h, remaining, page_empty=cur.is_empty())
        if split is not None:
            head, head_h, tail, tail_h = split
            cur.add(head, head_h, head_h)
            if not with_figure:
                cur.single_committed = True
            ctx.heights[tail["id"]] = tail_h
            ctx.heights_single[tail["id"]] = tail_h
            flush()
            cur = continuation()
            queue.appendleft(tail)
            continue
        if cur.is_empty():
            # Nothing else on the page: accept it if it physically fits (no safety margin), else warn.
            # the bottom margin is invisible, so it does not count towards clipping
            hard = ctx.capacity / SAFETY
            if acc.gap_for(h) + h.height > hard:
                ctx.warnings.append(f"block {b.get('id')} ({t}) is taller than a page; it will be clipped")
            cur.add(b, h_col, h_single)
            continue
        # move the block whole; a heading left at the bottom of the page goes with it
        queue.appendleft(b)
        if cur.blocks and cur.blocks[-1]["type"] == "heading" and len(cur.blocks) > 1:
            queue.appendleft(cur.blocks.pop())
        flush()
        cur = continuation()
    flush()
    for p in pages:
        for blk in p.blocks:
            blk.pop("_order", None)
        if p.figure is not None:
            p.figure.pop("_order", None)
    return pages


def _height(heights: dict[str, BlockHeight], b: dict[str, Any]) -> BlockHeight:
    try:
        return heights[b["id"]]
    except KeyError:
        raise KeyError(f"no measured height for block {b.get('id')!r}") from None


def _keep_with_next(ctx: PaginateContext, b: dict[str, Any], queue: deque) -> float:
    """Extra height a heading must reserve so it is never left alone at the bottom."""
    if b["type"] != "heading":
        return 0.0
    lines = 3 if b["level"] <= 2 else 2
    if queue:
        nxt = queue[0]
        nid = nxt.get("id")
        if nxt["type"] in FIGURE_TYPES:
            if ctx.columns == "split":
                return 0.0  # the figure goes to the figure slot on this page
            table = ctx.heights if ctx.columns == "two" else ctx.heights_single
            if nid in table:
                h = table[nid]
                return h.margin_top + h.height + h.margin_bottom  # figures are never split
        elif nid in ctx.heights:
            return min(ctx.heights[nid].height, lines * ctx.line_px)
    return lines * ctx.line_px


# --------------------------------------------------------------------------
# splitting
# --------------------------------------------------------------------------

_split_counter = itertools.count(1)


def _tail_id(b: dict[str, Any]) -> str:
    """Unique id for the tail of a split block. A plain '.2' suffix collided when the
    same block was split twice (column boundary, then balancing) and the second tail's
    heights overwrote the first's."""
    return f"{b['id']}.s{next(_split_counter)}"


def _try_split(ctx: PaginateContext, b: dict[str, Any], h: BlockHeight, remaining: float, page_empty: bool):
    t = b["type"]
    whole_fits_empty_page = h.margin_top + h.height + h.margin_bottom <= ctx.capacity
    if t == "table" and h.rows:
        return _split_table(b, h, remaining, whole_fits_empty_page, page_empty)
    if t == "code" and h.lines:
        return _split_code(b, h, remaining, whole_fits_empty_page, page_empty)
    if t == "list" and h.items:
        return _split_list(b, h, remaining, page_empty)
    if t == "paragraph" and h.line_offsets and h.line_height:
        return _split_paragraph(b, h, remaining, page_empty)
    return None


def _split_table(b, h: BlockHeight, remaining, whole_fits, page_empty):
    rows = h.rows or []
    if len(rows) != len(b["rows"]):
        return None  # measured heights do not belong to this block's rows
    if whole_fits and not page_empty:
        return None
    budget = remaining - h.thead - h.margin_bottom
    k = 0
    acc = 0.0
    for r in rows:
        if acc + r > budget:
            break
        acc += r
        k += 1
    if k < MIN_TABLE_HEAD_ROWS or k >= len(rows):
        return None
    head = dict(b, rows=b["rows"][:k])
    tail = dict(b, rows=b["rows"][k:], continued=True, id=_tail_id(b))
    tail.pop("_order", None)
    head_h = BlockHeight(h.thead + acc, h.margin_top, h.margin_bottom)
    cap = (h.line_height or 0) * 0.8
    tail_h = BlockHeight(h.thead + sum(rows[k:]) + cap, h.margin_top, h.margin_bottom, thead=h.thead, rows=rows[k:], line_height=h.line_height)
    return head, head_h, tail, tail_h


def _split_code(b, h: BlockHeight, remaining, whole_fits, page_empty):
    lines = h.lines or []
    if len(lines) != len(b["lines"]) or len(lines) < MIN_CODE_LINES_TO_SPLIT:
        return None
    budget = remaining - h.padding - h.margin_bottom
    k = 0
    acc = 0.0
    for l in lines:
        if acc + l > budget:
            break
        acc += l
        k += 1
    if k < MIN_CODE_SIDE_LINES or len(lines) - k < MIN_CODE_SIDE_LINES:
        return None
    head = dict(b, lines=b["lines"][:k])
    tail = dict(b, lines=b["lines"][k:], continued=True, id=_tail_id(b))
    tail.pop("_order", None)
    note = lines[0]
    head_h = BlockHeight(h.padding + acc, h.margin_top, h.margin_bottom)
    tail_h = BlockHeight(h.padding + sum(lines[k:]) + note, h.margin_top, h.margin_bottom, lines=lines[k:], padding=h.padding)
    return head, head_h, tail, tail_h


def _split_list(b, h: BlockHeight, remaining, page_empty):
    items = h.items or []
    if len(items) != len(b["items"]):
        return None  # measured heights do not belong to this block's items
    budget = remaining - h.margin_bottom
    k = 0
    acc = 0.0
    for it in items:
        if acc + it > budget:
            break
        acc += it
        k += 1
    if k < 1 or k >= len(items):
        return None
    head = dict(b, items=b["items"][:k])
    tail = dict(b, items=b["items"][k:], id=_tail_id(b))
    if b.get("ordered"):
        tail["start"] = int(b.get("start", 1)) + k
    tail.pop("_order", None)
    head_h = BlockHeight(acc, h.margin_top, h.margin_bottom)
    tail_h = BlockHeight(sum(items[k:]), h.margin_top, h.margin_bottom, items=items[k:])
    return head, head_h, tail, tail_h


def _split_paragraph(b, h: BlockHeight, remaining, page_empty):
    offsets = h.line_offsets or [0]
    lh = h.line_height or 0
    n = len(offsets)
    budget = remaining - h.margin_bottom
    k = int(budget // lh) if lh > 0 else 0
    if k < MIN_PARAGRAPH_SIDE_LINES or n - k < MIN_PARAGRAPH_SIDE_LINES:
        return None
    parts = split_inline(b["text"], offsets[k])
    if parts is None:
        return None
    head_text, tail_text = parts
    head = dict(b, text=head_text)
    tail = dict(b, text=tail_text, id=_tail_id(b))
    tail.pop("_order", None)
    head_h = BlockHeight(k * lh, h.margin_top, h.margin_bottom)
    tail_h = BlockHeight((n - k) * lh, h.margin_top, h.margin_bottom, line_height=lh,
                         line_offsets=[o - offsets[k] for o in offsets[k:]])
    return head, head_h, tail, tail_h


# --------------------------------------------------------------------------
# build: spill per existing page
# --------------------------------------------------------------------------

@dataclass
class Spill:
    source: str
    target: str
    blocks: list[str]


def spill_pages(pages: list[dict[str, Any]], make_ctx, layout_columns_for_page,
                existing_ids: set[str] | None = None) -> tuple[list[dict[str, Any]], list[Spill]]:
    """Re-run pagination per page, keeping page boundaries as the starting
    point. Returns (new pages, spills). `existing_ids` lists every page id already
    in use (when only a subset of the document is re-laid out)."""
    existing = set(existing_ids) if existing_ids else set()
    existing |= {p["id"] for p in pages}
    out: list[dict[str, Any]] = []
    spills: list[Spill] = []
    for page in pages:
        if page["kind"] in ("source", "cover"):
            out.append(page)
            continue
        ctx = make_ctx(layout_columns_for_page(page))
        result = paginate(page["blocks"], ctx, initial_title=page["title"], initial_continued=page["continued"])
        if not result:
            out.append(page)
            continue
        first = result[0].to_json()
        first["id"] = page["id"]
        first["kind"] = page["kind"]
        first["continued"] = page["continued"]
        out.append(first)
        prev_id = page["id"]
        for extra in result[1:]:
            new_id = _unique_id(page["id"], existing)
            existing.add(new_id)
            j = extra.to_json()
            j["id"] = new_id
            j["kind"] = "content"
            out.append(j)
            spills.append(Spill(prev_id, new_id, [b.get("id", "") for b in j["blocks"]]))
            prev_id = new_id
    return out, spills


def _unique_id(base: str, existing: set[str]) -> str:
    n = 2
    while f"{base}-{n}" in existing:
        n += 1
    return f"{base}-{n}"


# --------------------------------------------------------------------------
# two-column flow (docs/04 section 4.7): fill the left column top to bottom,
# then the right column (column order; traced on the page it forms a mirrored N). Wide blocks (many-column tables,
# code, wide figures) become full-width bands; the two-column region above a
# band is balanced so both columns end at the same height.
# --------------------------------------------------------------------------

WIDE_TABLE_COLUMNS = 4
BALANCE_MIN_RATIO = 0.4   # even out the columns only when the region is taller than 40% of the space


def _fit_scale(box: tuple[float, float], w: float, h: float) -> float:
    """Scale at which a w x h figure fits a (width, max height) box, never enlarged."""
    return min(box[0] / w, box[1] / h, 1.0)


@dataclass
class Region:
    left: list[dict[str, Any]] = field(default_factory=list)
    right: list[dict[str, Any]] = field(default_factory=list)
    left_acc: Accumulator = field(default_factory=Accumulator)
    right_acc: Accumulator = field(default_factory=Accumulator)
    left_full: bool = False

    def is_empty(self) -> bool:
        return not self.left and not self.right

    def height(self) -> float:
        left = self.left_acc.used + (self.left_acc.last_mb if self.left else 0.0)
        right = self.right_acc.used + (self.right_acc.last_mb if self.right else 0.0)
        return max(left, right)


@dataclass
class TwoColPage(Page):
    segments: list[tuple] = field(default_factory=list)   # ("cols", Region) | ("wide", block, BlockHeight)
    used_before: float = 0.0                              # height of the closed segments
    region: Region | None = None

    def is_empty(self) -> bool:
        return not self.segments and (self.region is None or self.region.is_empty())

    def to_json(self) -> dict[str, Any]:
        """Blocks are emitted in source order (a floated figure keeps its place in the
        content); `_layout` records where each block was placed on the page."""
        segments = list(self.segments)
        if self.region is not None and not self.region.is_empty():
            segments.append(("cols", self.region))
        tagged: list[tuple[dict[str, Any], tuple]] = []
        for s, seg in enumerate(segments):
            if seg[0] == "cols":
                reg: Region = seg[1]
                tagged.extend((b, ("cols", s, "left")) for b in reg.left)
                tagged.extend((b, ("cols", s, "right")) for b in reg.right)
            else:
                tagged.append((seg[1], ("wide", s)))
        tagged.sort(key=lambda bt: bt[0].get("_order", float("inf")))
        # copies without the runtime order key, so that to_json() can be called more than once
        blocks = [{k: v for k, v in b.items() if k != "_order"} for b, _ in tagged]
        layout: list[dict[str, Any]] = []
        for s, seg in enumerate(segments):
            if seg[0] == "cols":
                layout.append({"kind": "cols",
                               "left": [i for i, (_, tag) in enumerate(tagged) if tag == ("cols", s, "left")],
                               "right": [i for i, (_, tag) in enumerate(tagged) if tag == ("cols", s, "right")]})
            else:
                layout.append({"kind": "wide", "index": next(i for i, (_, tag) in enumerate(tagged) if tag == ("wide", s))})
        return {"id": self.id, "kind": self.kind, "title": self.title, "continued": self.continued,
                "blocks": blocks, "_layout": layout}


def _next_order(order: Any) -> float:
    """Source-order key for the tail of a split block: after its head, before the next block."""
    o = float(order) if order is not None else float("inf")
    if o == float("inf"):
        return o
    return o + 0.5 if o == int(o) else o + (math.ceil(o) - o) / 2.0


def is_wide(block: dict[str, Any], ctx: PaginateContext, queue: deque | None = None) -> bool:
    """Whether a block takes the full width in two-column mode."""
    override = ctx.span_override.get(block.get("id", ""))
    if override in (1, 2):
        return override == 2
    t = block["type"]
    if t == "heading":
        # a heading directly followed by a wide block goes above the band
        if queue and queue[0]["type"] != "heading":
            return is_wide(queue[0], ctx, None)
        return False
    if t == "table":
        return len(block["header"]) >= WIDE_TABLE_COLUMNS
    if t in ("code", "html"):
        return True
    if t in FIGURE_TYPES:
        # a figure becomes a band when the band box renders it larger than a column would
        h = ctx.heights.get(block.get("id", ""))
        if h and h.intrinsic_w > 0 and h.intrinsic_h > 0:
            if ctx.col_box is None or ctx.band_box is None:
                raise ValueError("two-column pagination needs col_box and band_box to place figures")
            return _fit_scale(ctx.band_box, h.intrinsic_w, h.intrinsic_h) > _fit_scale(ctx.col_box, h.intrinsic_w, h.intrinsic_h)
        return False
    return False


def paginate_two_columns(blocks: list[dict[str, Any]], ctx: PaginateContext,
                         initial_title: str | None = None, initial_continued: bool = False) -> list[Page]:
    pages: list[Page] = []
    queue: deque[dict[str, Any]] = deque(copy.deepcopy(blocks))
    for i, b in enumerate(queue):
        b.setdefault("_order", i)
    cur = TwoColPage(title=initial_title, continued=initial_continued)

    def close_region(balance: bool) -> None:
        if cur.region is None:
            return
        if cur.region.is_empty():
            cur.region = None
            return
        if balance and cur.region.height() > BALANCE_MIN_RATIO * (ctx.capacity - cur.used_before):
            _balance_region(cur.region, ctx)
        cur.segments.append(("cols", cur.region))
        cur.used_before += cur.region.height()
        cur.region = None

    def flush(balance: bool = False) -> None:
        """balance=True when the page ends on a section break (not by overflow):
        the open two-column region is then evened out so both columns end together."""
        nonlocal cur
        close_region(balance=balance)
        if not cur.is_empty():
            pages.append(cur)

    def continuation() -> TwoColPage:
        return TwoColPage(title=cur.title, continued=cur.title is not None or ctx.is_slide)

    def register_tail(head: dict[str, Any], tail: dict[str, Any], tail_h: BlockHeight) -> None:
        ctx.heights[tail["id"]] = tail_h
        ctx.heights_single[tail["id"]] = tail_h
        tail["_order"] = _next_order(head.get("_order"))

    while queue:
        b = queue.popleft()
        t = b["type"]
        if t == "pagebreak":
            flush(balance=True)
            cur = TwoColPage(title=cur.title, continued=cur.title is not None)
            continue
        if t == "heading" and b["level"] == 1:
            if ctx.is_slide:
                flush(balance=True)
                cover = Page(kind="cover", blocks=[b])
                if queue and queue[0]["type"] == "paragraph":
                    cover.blocks.append(queue.popleft())
                pages.append(cover)
                cur = TwoColPage(title=ctx.doc_title, continued=False)
                continue
            if not cur.is_empty():
                flush(balance=True)
                cur = TwoColPage()
        if t == "heading" and b["level"] == 2 and ctx.is_slide:
            flush(balance=True)
            cur = TwoColPage(title=b["text"], continued=False)
            continue

        if is_wide(b, ctx, queue):
            close_region(balance=True)
            h = _height(ctx.heights_single, b)
            keep = _keep_with_next(ctx, b, queue)
            if cur.used_before + h.outer + keep <= ctx.capacity:
                cur.segments.append(("wide", b, h))
                cur.used_before += h.outer
                continue
            remaining = ctx.capacity - cur.used_before - h.margin_top
            split = _try_split(ctx, b, h, remaining, page_empty=cur.is_empty())
            if split is not None:
                head, head_h, tail, tail_h = split
                cur.segments.append(("wide", head, head_h))
                cur.used_before += head_h.outer
                register_tail(head, tail, tail_h)
                flush()
                cur = continuation()
                queue.appendleft(tail)
                continue
            if cur.is_empty():
                if h.margin_top + h.height > ctx.capacity / SAFETY:
                    ctx.warnings.append(f"block {b.get('id')} ({t}) is taller than a page; it will be clipped")
                cur.segments.append(("wide", b, h))
                cur.used_before += h.outer
                continue
            queue.appendleft(b)
            if cur.segments and cur.segments[-1][0] == "wide" and cur.segments[-1][1]["type"] == "heading" and len(cur.segments) > 1:
                heading = cur.segments.pop()
                cur.used_before -= heading[2].outer
                queue.appendleft(heading[1])
            flush()
            cur = continuation()
            continue

        # column flow
        if cur.region is None:
            cur.region = Region()
        reg = cur.region
        limit = ctx.capacity - cur.used_before
        h = _height(ctx.heights, b)
        keep = _keep_with_next(ctx, b, queue)
        col_blocks, acc = (reg.right, reg.right_acc) if reg.left_full else (reg.left, reg.left_acc)
        if acc.used + acc.needed(h) + keep <= limit:
            col_blocks.append(b)
            acc.add(h)
            continue
        # a figure that no longer fits the left column floats to the top of the empty right
        # column; the text keeps flowing in the left column beside it (magazine-style)
        if (t in FIGURE_TYPES and not reg.left_full and not reg.right
                and reg.right_acc.needed(h) <= limit):
            reg.right.append(b)
            reg.right_acc.add(h)
            continue
        remaining = acc.remaining(limit, h)
        split = _try_split(ctx, b, h, remaining, page_empty=(acc.count == 0))
        if split is not None:
            head, head_h, tail, tail_h = split
            col_blocks.append(head)
            acc.add(head_h)
            register_tail(head, tail, tail_h)
            queue.appendleft(tail)
            if not reg.left_full:
                reg.left_full = True
            else:
                flush()
                cur = continuation()
            continue
        if acc.count == 0 and cur.used_before == 0:
            if acc.gap_for(h) + h.height > limit / SAFETY:
                ctx.warnings.append(f"block {b.get('id')} ({t}) is taller than a column; it will be clipped")
            col_blocks.append(b)
            acc.add(h)
            continue
        # move the block whole to the next column / page, taking a trailing heading along
        queue.appendleft(b)
        if col_blocks and col_blocks[-1]["type"] == "heading" and len(col_blocks) > 1:
            moved = col_blocks.pop()
            queue.appendleft(moved)
            _rebuild_accumulator(acc, col_blocks, ctx.heights)
        if not reg.left_full and acc.count > 0:
            reg.left_full = True
        else:
            flush()
            cur = continuation()
    flush(balance=True)
    for p in pages:
        for blk in p.blocks:
            blk.pop("_order", None)
    return pages


def _rebuild_accumulator(acc: Accumulator, blocks: list[dict[str, Any]], heights: dict[str, BlockHeight]) -> None:
    acc.used, acc.last_mb, acc.count = 0.0, 0.0, 0
    for b in blocks:
        acc.add(heights[b["id"]])


def _balance_region(reg: Region, ctx: PaginateContext) -> None:
    """Redistribute the region's blocks (in source order) over both columns so they
    end at roughly the same height (used when a band follows or the page ends early)."""
    blocks = sorted(reg.left + reg.right, key=lambda b: b.get("_order", float("inf")))
    total_acc = Accumulator()
    for b in blocks:
        total_acc.add(ctx.heights[b["id"]])
    target = (total_acc.used + total_acc.last_mb) / 2.0
    left: list[dict[str, Any]] = []
    right: list[dict[str, Any]] = []
    lacc = Accumulator()
    for b in blocks:
        if right:
            right.append(b)
            continue
        h = ctx.heights[b["id"]]
        if lacc.used + lacc.needed(h) <= target:
            left.append(b)
            lacc.add(h)
            continue
        split = _try_split(ctx, b, h, lacc.remaining(target, h), page_empty=True)
        if split is not None:
            head, head_h, tail, tail_h = split
            left.append(head)
            lacc.add(head_h)
            ctx.heights[tail["id"]] = tail_h
            ctx.heights_single[tail["id"]] = tail_h
            tail["_order"] = _next_order(head.get("_order"))
            right.append(tail)
        elif not left:
            left.append(b)  # an unsplittable first block stays left, whatever its height
            lacc.add(h)
        else:
            right.append(b)
    if right and left and left[-1]["type"] == "heading" and len(left) > 1:
        right.insert(0, left.pop())
    lacc = Accumulator()
    racc = Accumulator()
    _rebuild_accumulator(lacc, left, ctx.heights)
    _rebuild_accumulator(racc, right, ctx.heights)
    new_height = max(lacc.used + (lacc.last_mb if left else 0.0),
                     racc.used + (racc.last_mb if right else 0.0))
    if new_height > reg.height() + 0.5:
        # the source-order redistribution would be taller than the current placement
        # (typically a floated figure followed by long text): keep the current placement
        return
    reg.left, reg.right = left, right
    reg.left_acc, reg.right_acc = lacc, racc
    reg.left_full = True


def flatten_for_reflow(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Concatenate all blocks, merging continued tables/code with their predecessor."""
    blocks: list[dict[str, Any]] = []
    for page in pages:
        if page["kind"] == "source":
            continue
        for b in page["blocks"]:
            if b.get("continued") and blocks and blocks[-1]["type"] == b["type"]:
                prev = blocks[-1]
                if b["type"] == "table":
                    prev["rows"] = prev["rows"] + b["rows"]
                    continue
                if b["type"] == "code":
                    prev["lines"] = prev["lines"] + b["lines"]
                    continue
            nb = dict(b)
            nb.pop("continued", None)
            blocks.append(nb)
    return blocks
