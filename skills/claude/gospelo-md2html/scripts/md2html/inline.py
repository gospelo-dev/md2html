"""Inline Markdown: rendering and line-level splitting (decision 13).

Text in the content JSON stays inline Markdown. Rendering uses markdown-it.
Splitting a paragraph at a measured line boundary works on the inline token
stream: plain-text offsets (as the browser's textContent counts them) are
mapped back to tokens, open spans are closed/reopened, and both halves are
re-serialised to Markdown. Unknown token types disable splitting (the caller
then moves the whole paragraph).
"""

from __future__ import annotations

from markdown_it import MarkdownIt

_md = MarkdownIt("gfm-like", {"linkify": False})
_md.enable("table")

_ESCAPE_CHARS = "\\*_`[]<~"


def render_inline(text: str) -> str:
    return _md.renderInline(text)


def plain_text(text: str) -> str:
    """The textContent the browser will produce for render_inline(text)."""
    tokens = _md.parseInline(text)[0].children or []
    out = []
    for tok in tokens:
        if tok.type in ("text", "code_inline"):
            out.append(tok.content)
        elif tok.type == "softbreak":
            out.append("\n")
    return "".join(out)


def _escape_text(s: str) -> str:
    return "".join("\\" + c if c in _ESCAPE_CHARS else c for c in s)


def _serialize(tokens) -> str | None:
    out: list[str] = []
    for tok in tokens:
        t = tok.type
        if t == "text":
            out.append(_escape_text(tok.content))
        elif t == "code_inline":
            fence = "`" * (max((len(m) for m in _runs(tok.content, "`")), default=0) + 1)
            out.append(f"{fence}{tok.content}{fence}")
        elif t in ("strong_open", "strong_close"):
            out.append("**")
        elif t in ("em_open", "em_close"):
            out.append("*")
        elif t in ("s_open", "s_close"):
            out.append("~~")
        elif t == "link_open":
            out.append("[")
        elif t == "link_close":
            out.append(f"]({tok.attrGet('href') or ''})")
        elif t == "image":
            alt = tok.content
            out.append(f"![{alt}]({tok.attrGet('src') or ''})")
        elif t == "softbreak":
            out.append(" ")
        elif t == "hardbreak":
            out.append("  \n")
        else:
            return None
    return "".join(out)


def _runs(s: str, ch: str):
    run = 0
    for c in s:
        if c == ch:
            run += 1
        else:
            if run:
                yield "`" * run
            run = 0
    if run:
        yield "`" * run


_OPEN_TO_CLOSE = {"strong_open": "strong_close", "em_open": "em_close", "s_open": "s_close", "link_open": "link_close"}


def split_inline(text: str, offset: int) -> tuple[str, str] | None:
    """Split inline Markdown so that the head holds the first `offset` plain
    characters. Returns (head, tail) or None when splitting is not safe."""
    tokens = list(_md.parseInline(text)[0].children or [])
    pos = 0
    split_idx = None
    split_in_token = 0
    for i, tok in enumerate(tokens):
        length = len(tok.content) if tok.type in ("text", "code_inline") else (1 if tok.type == "softbreak" else 0)
        if pos + length >= offset and length > 0:
            split_idx = i
            split_in_token = offset - pos
            break
        pos += length
    if split_idx is None:
        return None
    tok = tokens[split_idx]
    if tok.type == "code_inline" or tok.type == "softbreak":
        # Never split inside code; cut at the token boundary instead.
        head_tokens = tokens[:split_idx]
        tail_tokens = tokens[split_idx:]
        if tok.type == "softbreak":
            tail_tokens = tokens[split_idx + 1:]
    else:
        head_text, tail_text = tok.content[:split_in_token].rstrip(), tok.content[split_in_token:].lstrip()
        head_tok = _clone_text(tok, head_text)
        tail_tok = _clone_text(tok, tail_text)
        head_tokens = tokens[:split_idx] + ([head_tok] if head_text else [])
        tail_tokens = ([tail_tok] if tail_text else []) + tokens[split_idx + 1:]
    # close open spans in head, reopen them in tail
    stack = []
    for t in head_tokens:
        if t.type in _OPEN_TO_CLOSE:
            stack.append(t)
        elif t.type in _OPEN_TO_CLOSE.values():
            if stack:
                stack.pop()
    closers = [_close_for(t) for t in reversed(stack)]
    head = _serialize(head_tokens + closers)
    tail = _serialize(list(stack) + tail_tokens)
    if head is None or tail is None:
        return None
    head, tail = head.rstrip(), tail.lstrip()
    if not head or not tail:
        return None
    return head, tail


def _clone_text(tok, content):
    from markdown_it.token import Token
    t = Token("text", "", 0)
    t.content = content
    return t


def _close_for(open_tok):
    from markdown_it.token import Token
    return Token(_OPEN_TO_CLOSE[open_tok.type], "", -1)
