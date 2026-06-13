#!/usr/bin/env bash
# markup-mode one-shot applier
#
# Splices the self-contained review layer into an HTML target in a single
# command (replaces the manual skill-read -> grep-markers -> read-template ->
# inject sequence). Writes the markup-enabled copy to the CURRENT WORKING
# DIRECTORY by default, and records the ORIGINAL artifact's path in the layer's
# `Source:` line via MarkupModeConfig.sourcePath, so a compiled export points at
# the original — not at the copy the reviewer happens to be viewing.
#
# Usage:
#   scripts/apply.sh <target.html|doc.md> [--out PATH] [--source PATH]
#                    [--accent COLOR] [--ns NAME] [--shortcut CHORD] [--theme FILE.json] [--template PATH]
#                    [--verify static|full] [--safe] [--md-engine pandoc|node|python]
#
#   <target>          HTML file (.html) OR Markdown doc (.md/.markdown) to add
#                     the review layer to (required). A .md is rendered to a
#                     self-contained HTML preview, then spliced like any HTML.
#   --out PATH        Output file or dir. Default: ./<base>.markup.html (CWD).
#   --source PATH     Path recorded in the compiled `Source:` line.
#                     Default: absolute path of the ORIGINAL target (the .md/.html).
#   --accent COLOR    Override the layer accent (e.g. "#3b82f6").
#   --ns NAME         localStorage namespace (share one note set across URLs).
#   --shortcut CHORD  Toggle shortcut, e.g. "mod+shift+k" (mod = Cmd/Ctrl). Baked
#                     into MarkupModeConfig.shortcut; rides the keymap engine.
#   --keymap K=CHORD  Rebind one key, repeatable. K is toggle | addRef | resizeUp
#                     | resizeDown | copyRef. CHORD is "mod+shift+k" (toggle/copyRef),
#                     a key like "ArrowUp" (resize*), or a modifier "alt|shift|ctrl|meta"
#                     (addRef). Baked into MarkupModeConfig.keymap.
#   --theme FILE.json Bake a theme document (colors + font + fontScale) into
#                     MarkupModeConfig.theme. Inlined at apply time — no runtime
#                     fetch, so file:// artifacts stay self-contained. See
#                     references/adaptation.md for the schema + example themes/.
#   --config PATH     Pre-build settings file (default: ../markup-mode.config.jsonc).
#                     Its values are the default source for accent/ns/shortcut/theme/
#                     keymap/behavior; an explicit flag above overrides per key. See
#                     references/adaptation.md and scripts/config.sh.
#   --no-config       Ignore the settings file entirely (built-in defaults + flags only).
#   --template PATH   Layer source. Default: ../assets/templates/markup-mode.html.
#   --verify MODE     static (default) = run the static self-check only.
#                     full = also print the headless-verify recipe (the skill
#                     runs the browser check; this script never spawns one).
#   --safe            (Markdown only) best-effort strip of raw <script>/<style>,
#                     on* handlers, and javascript:/data:text/html URLs from the
#                     rendered HTML. For locally-trusted review, not a security
#                     boundary. Default: pass raw HTML through (author trusts doc).
#   --md-engine ENG   (Markdown only) force the converter: pandoc | node | python.
#                     Default auto: pandoc -> node. python (reduced GFM fidelity)
#                     is reachable only when explicitly selected here.
#   --force           Splice even if the target looks like a client-rendered app
#                     shell (Databricks/Next/Nuxt/Angular/React/empty-body SPA).
#                     By default such targets are REFUSED with an explanation,
#                     because the host's own JS replaces the body at load and the
#                     injected layer never appears. Use only if you know the page
#                     is actually static (or you'll snapshot the rendered DOM).
#
# Always finishes with a STATIC SELF-CHECK so the default path is
# "apply + self-check" in one round. Exit 0 = applied + checks passed.

set -uo pipefail

# Markdown route renders to a temp HTML preview; clean it up on any exit.
MD_PREVIEW=""
trap '[ -n "$MD_PREVIEW" ] && rm -f "$MD_PREVIEW"' EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/../assets/templates/markup-mode.html"
MD_HOST="${SCRIPT_DIR}/../assets/templates/markdown-host.html"
MD_POST="${SCRIPT_DIR}/md_postprocess.py"

usage() { sed -n '2,58p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

TARGET="" OUT="" SOURCE="" ACCENT="" NS="" VERIFY="static" SAFE="" MD_ENGINE="" SHORTCUT="" THEME_FILE=""
CONFIG_FILE="" NO_CONFIG="" KEYMAP_SPECS=() FORCE=""
# Track which knobs were set by an explicit flag (flag > config-file precedence).
FLAG_ACCENT="" FLAG_NS="" FLAG_SHORTCUT="" FLAG_THEME="" FLAG_SOURCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)       OUT="${2:-}"; shift 2;;
    --source)    SOURCE="${2:-}"; FLAG_SOURCE=1; shift 2;;
    --accent)    ACCENT="${2:-}"; FLAG_ACCENT=1; shift 2;;
    --ns)        NS="${2:-}"; FLAG_NS=1; shift 2;;
    --shortcut)  SHORTCUT="${2:-}"; FLAG_SHORTCUT=1; shift 2;;
    --theme)     THEME_FILE="${2:-}"; FLAG_THEME=1; shift 2;;
    --keymap)    KEYMAP_SPECS+=("${2:-}"); shift 2;;
    --config)    CONFIG_FILE="${2:-}"; shift 2;;
    --no-config) NO_CONFIG=1; shift;;
    --template)  TEMPLATE="${2:-}"; shift 2;;
    --verify)    VERIFY="${2:-}"; shift 2;;
    --safe)      SAFE=1; shift;;
    --force)     FORCE=1; shift;;
    --md-engine) MD_ENGINE="${2:-}"; shift 2;;
    -h|--help)  usage; exit 0;;
    --) shift; break;;
    -*) echo "error: unknown flag: $1" >&2; usage >&2; exit 2;;
    *)  if [ -z "$TARGET" ]; then TARGET="$1"; shift; else echo "error: unexpected arg: $1" >&2; exit 2; fi;;
  esac
done

[ -n "$TARGET" ]   || { echo "error: <target.html> is required" >&2; usage >&2; exit 2; }
[ -f "$TARGET" ]   || { echo "error: target not found: $TARGET" >&2; exit 2; }
[ -f "$TEMPLATE" ] || { echo "error: template not found: $TEMPLATE" >&2; exit 2; }
case "$VERIFY" in static|full) ;; *) echo "error: --verify must be static|full" >&2; exit 2;; esac
case "${MD_ENGINE:-}" in ""|pandoc|node|python) ;; *) echo "error: --md-engine must be pandoc|node|python" >&2; exit 2;; esac

# ---- Pre-build settings file (the one config that governs all applications) ----
# Read the merged config JSON once. Loud-but-non-fatal: a malformed file warns to
# stderr and yields {} so apply NEVER hard-crashes on bad config (apply is a build
# tool — a broken settings file must not break every artifact). CLI flags above
# still win per key; --no-config ignores the file entirely.
CONFIG_JSON="{}"
CONFIG_USED=""
cfg_path=""
if [ -z "$NO_CONFIG" ]; then
  CONFIG_SH="${SCRIPT_DIR}/config.sh"
  cfg_path=""
  if [ -n "$CONFIG_FILE" ]; then cfg_path="$CONFIG_FILE"; else cfg_path="${SCRIPT_DIR}/../markup-mode.config.jsonc"; fi
  if [ -f "$cfg_path" ] && [ -f "$CONFIG_SH" ]; then
    CONFIG_JSON="$(MARKUP_MODE_CONFIG="$cfg_path" bash "$CONFIG_SH" read-json 2>/dev/null || echo '{}')"
    [ -z "$CONFIG_JSON" ] && CONFIG_JSON="{}"
    [ "$CONFIG_JSON" != "{}" ] && CONFIG_USED="$cfg_path"
  elif [ -n "$CONFIG_FILE" ] && [ ! -f "$CONFIG_FILE" ]; then
    echo "warning: --config file not found: $CONFIG_FILE (using built-in defaults)" >&2
  fi
fi

# ---- Markdown branch (renders .md/.markdown to a temp HTML preview up front) ----
# After rendering, TARGET is repointed at the preview so the splice/self-check
# tail below runs identically to the HTML route. The original .md is remembered
# for the Source: line default and the output filename stem.
MD_ENGINE_USED=""
case "$TARGET" in
  *.md|*.markdown|*.MD|*.Markdown|*.mkd)
    [ -f "$MD_HOST" ] || { echo "error: markdown host template not found: $MD_HOST" >&2; exit 1; }
    [ -f "$MD_POST" ] || { echo "error: markdown post-processor not found: $MD_POST" >&2; exit 1; }
    command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required for the Markdown route" >&2; exit 1; }

    MD_ORIG_ABS="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"
    md_base="$(basename "$TARGET")"; md_stem="${md_base%.*}"

    # Strip a leading YAML front-matter block ONLY when --- is the very first line.
    md_src="$(mktemp)"
    if [ "$(head -1 "$TARGET")" = "---" ]; then
      awk 'NR==1{next} !done && /^---[[:space:]]*$/ {done=1; next} done {print}' "$TARGET" > "$md_src"
    else
      cat "$TARGET" > "$md_src"
    fi

    # Pick the converter. Explicit --md-engine overrides; otherwise auto pandoc->node.
    eng="$MD_ENGINE"
    if [ -z "$eng" ]; then
      if   command -v pandoc >/dev/null 2>&1; then eng="pandoc"
      elif command -v npx >/dev/null 2>&1 || command -v node >/dev/null 2>&1; then eng="node"
      else
        echo "error: no Markdown converter found. Install one: 'brew install pandoc' (preferred) or use Node (npx marked)." >&2
        rm -f "$md_src"; exit 1
      fi
    fi

    frag="$(mktemp)"
    case "$eng" in
      pandoc)
        command -v pandoc >/dev/null 2>&1 || { echo "error: --md-engine pandoc requested but pandoc not found. 'brew install pandoc'." >&2; rm -f "$md_src" "$frag"; exit 1; }
        pandoc -f gfm -t html "$md_src" > "$frag" || { echo "error: pandoc failed to render $TARGET" >&2; rm -f "$md_src" "$frag"; exit 1; }
        MD_ENGINE_USED="pandoc ($(pandoc --version | head -1 | awk '{print $2}'))"
        ;;
      node)
        if command -v npx >/dev/null 2>&1; then
          npx --yes marked --gfm < "$md_src" > "$frag" 2>/dev/null || { echo "error: node (npx marked) failed to render $TARGET" >&2; rm -f "$md_src" "$frag"; exit 1; }
          MD_ENGINE_USED="node (npx marked)"
        else
          echo "error: --md-engine node requested but npx not found." >&2; rm -f "$md_src" "$frag"; exit 1
        fi
        ;;
      python)
        python3 -c 'import markdown' 2>/dev/null || { echo "error: --md-engine python requested but the 'markdown' package is not installed. 'pip install markdown'." >&2; rm -f "$md_src" "$frag"; exit 1; }
        echo "warning: --md-engine python uses python-markdown (reduced GFM fidelity: task lists render as literal [ ], bare URLs are not autolinked)."
        python3 -m markdown -x extra -x sane_lists "$md_src" > "$frag" || { echo "error: python-markdown failed to render $TARGET" >&2; rm -f "$md_src" "$frag"; exit 1; }
        MD_ENGINE_USED="python ($(python3 -c 'import markdown;print(markdown.__version__)' 2>/dev/null))"
        ;;
    esac
    [ -s "$frag" ] || { echo "error: converter produced an empty HTML fragment for $TARGET" >&2; rm -f "$md_src" "$frag"; exit 1; }

    # Fill the host shell (title derive+escape, optional --safe sanitize, relative-path rewrite).
    MD_PREVIEW="$(mktemp -t mm-preview.XXXXXX).html"
    post_args=(--template "$MD_HOST" --md-source "$MD_ORIG_ABS" --stem "$md_stem")
    [ -n "$SAFE" ] && post_args+=(--safe)
    python3 "$MD_POST" "${post_args[@]}" < "$frag" > "$MD_PREVIEW" || { echo "error: markdown post-processor failed" >&2; rm -f "$md_src" "$frag" "$MD_PREVIEW"; exit 1; }
    rm -f "$md_src" "$frag"

    # Default Source: = the ORIGINAL .md (not the temp preview); output stem from the .md.
    [ -z "$SOURCE" ] && SOURCE="$MD_ORIG_ABS"
    TARGET="$MD_PREVIEW"
    MD_STEM="$md_stem"
    ;;
esac

# ---- Host-suitability check (HTML route only; the Markdown preview is always static) ----
# Markup Mode splices a review layer into the page's HTML and anchors notes to the DOM that
# exists at load. A client-rendered app shell (Databricks notebook export, Next/Nuxt/Angular/
# React SPA, or a near-empty <body> filled by a JS bundle) replaces its own body at runtime, so
# the injected layer is discarded and never appears. Refuse those by default with an explanation;
# --force overrides (for a host that is actually static, or when the user will snapshot the
# rendered DOM first). Detection is best-effort and conservative — false negatives are fine
# (you just get the old behavior), and --force is always an escape hatch.
if [ -z "$MD_PREVIEW" ] && [ -z "$FORCE" ]; then
  host_kind=""
  if   grep -q '__DATABRICKS_NOTEBOOK_MODEL' "$TARGET" || grep -qi 'databricks-html-version' "$TARGET"; then host_kind="a Databricks notebook export"
  elif grep -q '__NEXT_DATA__' "$TARGET" || grep -qi 'id="__next"' "$TARGET"; then host_kind="a Next.js app shell"
  elif grep -qi 'id="__nuxt"' "$TARGET" || grep -q 'window.__NUXT__' "$TARGET"; then host_kind="a Nuxt app shell"
  elif grep -qi 'ng-version=' "$TARGET"; then host_kind="an Angular app shell"
  elif grep -qi 'data-reactroot' "$TARGET"; then host_kind="a server-rendered React app shell"
  elif command -v python3 >/dev/null 2>&1; then
    # Generic heuristic: a real external script bundle + a near-empty <body> (almost no visible
    # text, optionally just a root mount node) ⇒ the page builds its content client-side.
    host_kind="$(python3 - "$TARGET" <<'PY'
import sys, re
try:
    html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
except Exception:
    sys.exit(0)
m = re.search(r"<body\b[^>]*>(.*)</body>", html, re.I | re.S)
body = m.group(1) if m else ""
if not body:
    sys.exit(0)
has_bundle = bool(re.search(r"<script[^>]+\bsrc=", body, re.I))
has_root = bool(re.search(r"""<(?:div|main|app-root)[^>]*\bid=["'](?:root|app|__next|__nuxt|app-root)["']""", body, re.I))
b = re.sub(r"<script\b.*?</script>", " ", body, flags=re.I | re.S)
b = re.sub(r"<style\b.*?</style>", " ", b, flags=re.I | re.S)
b = re.sub(r"<!--.*?-->", " ", b, flags=re.S)
text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", b)).strip()
if has_bundle and (len(text) < 200) and (has_root or len(text) < 40):
    print("a client-rendered app shell (its <body> is built by a JavaScript bundle at load)")
PY
)"
  fi
  if [ -n "$host_kind" ]; then
    {
      echo "error: \"$TARGET\" looks like $host_kind, not a static HTML document."
      echo
      echo "  Markup Mode splices its review layer into the page and anchors notes to the DOM"
      echo "  present at load. This document renders its content at runtime with JavaScript and"
      echo "  replaces its own <body>, so the injected layer would be discarded and never appear."
      echo
      echo "  What works instead:"
      echo "    • Open the file in a browser, let it finish rendering, then File > Save Page As >"
      echo "      \"Webpage, Complete\" — and apply Markup Mode to that saved static copy."
      echo "    • Or export the source as Markdown and run:  scripts/apply.sh <doc>.md"
      echo
      echo "  If you know this page is actually static (or you'll snapshot the rendered DOM first),"
      echo "  re-run with --force:"
      echo "    scripts/apply.sh \"$TARGET\" --force"
    } >&2
    rm -f "$MD_PREVIEW"; exit 3
  fi
fi
[ -z "$FORCE" ] || { [ -z "$MD_PREVIEW" ] && echo "note: --force set — skipping the client-rendered-host check." >&2; }

grep -qi '</body>' "$TARGET" || { echo "error: target has no </body> to splice before: $TARGET" >&2; rm -f "$MD_PREVIEW"; exit 1; }

# Output: default to CWD; if --out is a directory, write the default name inside it.
base="$(basename "$TARGET")"; stem="${base%.*}"
[ -n "${MD_STEM:-}" ] && stem="$MD_STEM"
if   [ -z "$OUT" ];   then OUT="$(pwd)/${stem}.markup.html"
elif [ -d "$OUT" ];   then OUT="${OUT%/}/${stem}.markup.html"
fi

# Source: default to the ORIGINAL target's absolute path.
if [ -z "$SOURCE" ]; then SOURCE="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"; fi
# Normalize Source: to an absolute filesystem path so export can seed the save
# dialog near the original input even when --source is passed relatively.
SOURCE="$(
  python3 - "$SOURCE" <<'PY'
import os, sys, urllib.parse
s = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
if s.lower().startswith("file://"):
    u = urllib.parse.urlparse(s)
    s = urllib.parse.unquote(u.path or "")
if s:
    s = os.path.abspath(os.path.expanduser(s))
print(s)
PY
)"

# Extract the layer block: everything after the opening "copy from here" comment
# closes (-->) up to the "copy to here" marker (both <style> blocks + <script>).
BLOCK="$(awk '
  /MARKUP MODE - copy to here/   { inblock=0; next }
  /MARKUP MODE - copy from here/ { inblock=1; started=0; next }
  inblock && started { print; next }
  inblock && /-->/   { started=1; next }
' "$TEMPLATE")"
[ -n "$BLOCK" ] || { echo "error: could not extract layer block (markers missing in $TEMPLATE?)" >&2; exit 1; }

# Validate an explicit --theme file early (flag path stays a hard error; a bad
# themeFile inside the config file is handled leniently by the builder below).
if [ -n "$THEME_FILE" ]; then
  [ -f "$THEME_FILE" ] || { echo "error: --theme file not found: $THEME_FILE" >&2; exit 2; }
fi

# Build window.MarkupModeConfig by MERGING the settings file under the explicit
# CLI flags (flag > config file > built-in default), in Python so nested theme/
# keymap/behavior objects compose correctly. Emits a single-line JS object body.
# Precedence is enforced here: a flag value is passed as MM_FLAG_*; an empty flag
# means "fall back to the config file value (or built-in default)".
command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required to build the config" >&2; exit 1; }
_cfg_for_dir="${CONFIG_USED:-$cfg_path}"
if [ -n "$_cfg_for_dir" ]; then CONFIG_DIR="$(cd "$(dirname "$_cfg_for_dir")" 2>/dev/null && pwd || pwd)"; else CONFIG_DIR="$(pwd)"; fi
CFG_BODY="$(
  MM_CONFIG_JSON="$CONFIG_JSON" \
  MM_CONFIG_DIR="$CONFIG_DIR" \
  MM_SOURCE="$SOURCE" \
  MM_FLAG_ACCENT="$ACCENT" MM_HAS_ACCENT="$FLAG_ACCENT" \
  MM_FLAG_NS="$NS" MM_HAS_NS="$FLAG_NS" \
  MM_FLAG_SHORTCUT="$SHORTCUT" MM_HAS_SHORTCUT="$FLAG_SHORTCUT" \
  MM_FLAG_THEME="$THEME_FILE" MM_HAS_THEME="$FLAG_THEME" \
  MM_KEYMAP_SPECS="$(printf '%s\n' "${KEYMAP_SPECS[@]+"${KEYMAP_SPECS[@]}"}")" \
  python3 "${SCRIPT_DIR}/mm_build_config.py"
)" || { echo "error: failed to build MarkupModeConfig (see above)" >&2; exit 1; }
CONFIG_SCRIPT="<script>window.MarkupModeConfig = { $CFG_BODY };</script>"

# Splice CONFIG_SCRIPT + BLOCK in immediately before the LAST </body>. String-
# level (not line-based head/tail), so it also handles minified/single-line and
# no-trailing-newline hosts — a line splice crashes on `head -n 0` when </body>
# is on line 1. The inj temp file is kept until the self-check (host-preservation).
inj="$(mktemp)"; printf '%s\n%s\n' "$CONFIG_SCRIPT" "$BLOCK" > "$inj"
inj_lines="$(wc -l < "$inj" | tr -d ' ')"
INJ_FILE="$inj" perl -0777 -pe '
  BEGIN{ local $/; open my $f,"<",$ENV{INJ_FILE} or die "inj: $!"; our $blk=<$f>; close $f; }
  s{(</body>)(?!.*</body>)}{$blk$1}is;
' "$TARGET" > "$OUT" || { echo "error: failed to splice layer into $TARGET" >&2; rm -f "$inj"; exit 1; }

echo "Applied markup-mode layer:"
if [ -n "$MD_PREVIEW" ]; then
  echo "  target : $MD_ORIG_ABS (Markdown)"
  echo "  engine : $MD_ENGINE_USED"
  [ -n "$SAFE" ] && echo "  safe   : on (raw <script>/<style>/on*/js-urls stripped)"
else
  echo "  target : $TARGET"
fi
echo "  output : $OUT"
echo "  source : $SOURCE"
[ -n "$CONFIG_USED" ] && echo "  config : $CONFIG_USED (defaults; flags override)"
[ -n "$NO_CONFIG" ]   && echo "  config : (ignored via --no-config)"
[ -n "$ACCENT" ] && echo "  accent : $ACCENT"
[ -n "$SHORTCUT" ] && echo "  shortcut: $SHORTCUT"
[ -n "$THEME_FILE" ] && echo "  theme  : $THEME_FILE"
[ "${#KEYMAP_SPECS[@]}" -gt 0 ] && echo "  keymap : ${KEYMAP_SPECS[*]+${KEYMAP_SPECS[*]}}"

# ---- Static self-check (the default verification tier) ----
echo "Static self-check:"
ok=1
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; ok=0; }

if grep -q 'id="mm-style"' "$OUT" && grep -q '__mmLayer' "$OUT"; then pass "layer block present"; else fail "layer block present"; fi

# Invariant: the splice must add ZERO </body> tags (compare to target, not to 1 —
# a host may legitimately contain </body> in a comment, <pre>, or JS string).
body_out="$(grep -ic '</body>' "$OUT")"
body_in="$(grep -ic '</body>' "$TARGET")"
if [ "$body_in" -ge 1 ] && [ "$body_out" -eq "$body_in" ]; then pass "</body> count unchanged by splice ($body_in)"; else fail "</body> count changed by splice (target=$body_in, output=$body_out)"; fi

if grep -q 'MarkupModeConfig' "$OUT" && grep -q 'sourcePath' "$OUT"; then pass "MarkupModeConfig.sourcePath echoed"; else fail "MarkupModeConfig.sourcePath echoed"; fi

orig_lines="$(wc -l < "$TARGET" | tr -d ' ')"
out_lines="$(wc -l < "$OUT" | tr -d ' ')"
if [ "$out_lines" -eq "$((orig_lines + inj_lines))" ]; then
  pass "host content intact (pure insertion: $orig_lines + $inj_lines = $out_lines lines)"
else
  fail "host content intact (expected $((orig_lines + inj_lines)) lines, got $out_lines)"
fi

if INJ_FILE="$inj" TGT_FILE="$TARGET" OUT_FILE="$OUT" perl -e '
  local $/;
  open my $o,"<",$ENV{OUT_FILE} or die; my $out=<$o>; close $o;
  open my $i,"<",$ENV{INJ_FILE} or die; my $inj=<$i>; close $i;
  open my $t,"<",$ENV{TGT_FILE} or die; my $tgt=<$t>; close $t;
  my $p=index($out,$inj); exit 1 if $p<0;
  exit((substr($out,0,$p).substr($out,$p+length($inj))) eq $tgt ? 0 : 1);
'; then pass "host bytes preserved (pure insertion)"; else fail "host bytes preserved (pure insertion)"; fi
rm -f "$inj"

if [ "$VERIFY" = "full" ]; then
  echo "Full verification requested — for a headless check, serve and drive:"
  echo "    (cd \"$(dirname "$OUT")\" && python3 -m http.server 8147) &"
  echo "    # then navigate http://localhost:8147/$(basename "$OUT") and assert mount/toggle/compile in ONE browser_evaluate"
  echo "  For a human glance:  open \"$OUT\""
fi

[ "$ok" -eq 1 ] || { echo "Static self-check FAILED — do not ship this output." >&2; exit 1; }
echo "OK — apply + static self-check passed."
