#!/usr/bin/env python3
"""Post-process a rendered Markdown HTML fragment into a markup-mode host shell.

Reads the rendered HTML fragment from stdin and writes the filled host shell to
stdout. Handles: title derivation + HTML-escaping, optional --safe sanitization
(strip <script>/<style>, on* handlers, javascript:/data:text/html URLs), and
relative src/href rewriting to absolute file:// URLs anchored at the source
document's directory. All HTML-ish text work lives here (not in bash/sed) so
special characters in titles and content are handled correctly.
"""
import argparse
import html
import os
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit


def derive_title(md_text: str, stem: str) -> str:
    for line in md_text.splitlines():
        m = re.match(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", line)
        if m:
            return m.group(1).strip()
    return stem


def unsafe_url(value: str) -> bool:
    compact = re.sub(r"[\x00-\x20]+", "", html.unescape(value)).lower()
    return compact.startswith("javascript:") or compact.startswith("data:text/html")


def should_skip_url(value: str) -> bool:
    v = value.strip()
    return (
        v == ""
        or v.startswith("#")
        or v.startswith("//")
        or v.startswith("/")
        or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", v) is not None
    )


def file_url_for(value: str, src_dir: str) -> str:
    parts = urlsplit(value)
    raw_path = unquote(parts.path)
    abs_path = Path(src_dir, raw_path).resolve()
    url = abs_path.as_uri()
    if parts.query:
        url += "?" + quote(parts.query, safe="=&;%:@/?+,")
    if parts.fragment:
        url += "#" + quote(parts.fragment, safe="")
    return url


class FragmentPostprocessor(HTMLParser):
    """Rewrite rendered Markdown with HTML-aware attribute handling."""

    def __init__(self, src_dir: str, safe: bool):
        super().__init__(convert_charrefs=False)
        self.src_dir = src_dir
        self.safe = safe
        self.out: list[str] = []
        self.skip_depth = 0

    def emit_tag(self, tag: str, attrs: list[tuple[str, str | None]], *, close: bool = False) -> None:
        tag_l = tag.lower()
        if self.safe and tag_l in {"script", "style"}:
            return
        parts = [f"<{tag}"]
        for name, value in attrs:
            name_l = name.lower()
            if self.safe and name_l.startswith("on"):
                continue
            if value is None:
                parts.append(f" {name}")
                continue
            if name_l in {"href", "src"}:
                if self.safe and unsafe_url(value):
                    value = "#"
                elif not should_skip_url(value):
                    value = file_url_for(value, self.src_dir)
            parts.append(f' {name}="{html.escape(value, quote=True)}"')
        parts.append(" />" if close else ">")
        self.out.append("".join(parts))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.safe and tag.lower() in {"script", "style"}:
            self.skip_depth += 1
            return
        if not self.skip_depth:
            self.emit_tag(tag, attrs)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if not self.skip_depth:
            self.emit_tag(tag, attrs, close=True)

    def handle_endtag(self, tag: str) -> None:
        if self.safe and tag.lower() in {"script", "style"}:
            if self.skip_depth:
                self.skip_depth -= 1
            return
        if not self.skip_depth:
            self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.out.append(data)

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth:
            self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth:
            self.out.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        if not self.skip_depth:
            self.out.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        if not self.skip_depth:
            self.out.append(f"<!{decl}>")

    def handle_pi(self, data: str) -> None:
        if not self.skip_depth:
            self.out.append(f"<?{data}>")


def postprocess_fragment(fragment: str, src_dir: str, safe: bool) -> str:
    parser = FragmentPostprocessor(src_dir, safe)
    parser.feed(fragment)
    parser.close()
    return "".join(parser.out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--md-source", required=True)
    ap.add_argument("--stem", required=True)
    ap.add_argument("--safe", action="store_true")
    args = ap.parse_args()

    fragment = sys.stdin.read()
    md_text = ""
    try:
        with open(args.md_source, encoding="utf-8") as fh:
            md_text = fh.read()
    except OSError:
        pass

    title = derive_title(md_text, args.stem)

    src_dir = os.path.dirname(os.path.abspath(args.md_source))
    fragment = postprocess_fragment(fragment, src_dir, args.safe)

    with open(args.template, encoding="utf-8") as fh:
        shell = fh.read()

    escaped_title = html.escape(title, quote=False)
    shell = shell.replace("{{TITLE}}", escaped_title)

    start = "<!-- ==================== MARKUP-MODE:CONTENT START ==================== -->"
    end = "<!-- ===================== MARKUP-MODE:CONTENT END ===================== -->"
    si, ei = shell.find(start), shell.find(end)
    if si == -1 or ei == -1:
        sys.stderr.write("error: CONTENT markers not found in template\n")
        return 1
    shell = shell[: si + len(start)] + "\n" + fragment + "\n" + shell[ei:]

    sys.stdout.write(shell)
    return 0


if __name__ == "__main__":
    sys.exit(main())
