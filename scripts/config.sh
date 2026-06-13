#!/usr/bin/env bash
# config.sh — read/write the Markup Mode pre-build settings surface.
#
# ONE config file (markup-mode.config.jsonc at the repo root) whose values
# apply.sh bakes into every generated artifact at apply time. A human edits the
# file by hand; an agent edits it through `set` (validated, comment-preserving).
#
# Usage:
#   config.sh get <key>            # resolved value for <key> (defaults applied). Empty + exit 3 if unset/absent.
#   config.sh list                 # every known key = resolved value (config over default)
#   config.sh set <key> <value>    # validate, then write the key, preserving the header, comments, and other keys
#   config.sh unset <key>          # remove a key (revert to built-in default), preserving comments/other keys
#   config.sh read-json            # the full config merged over defaults, as compact JSON (used by apply.sh)
#   config.sh path                 # absolute path of the config file
#   config.sh init                 # create the file from the shipped template if absent; echo its path
#   config.sh validate             # parse + schema-check the file; exit 0 ok, 1 if it has problems (still non-fatal for apply)
#
# Keys are dotted paths into the JSON object, e.g.:
#   accent  bg  font  fontScale  ns  sourcePath  themeFile  autoTheme
#   shortcut            (chord string "mod+shift+k" OR key=value JSON)
#   keymap.addRef.mod   keymap.resizeUp.key  keymap.copyRef
#   behavior.themeMode  behavior.reduceMotion  behavior.showMarks  behavior.openOnReveal
#
# Posture:
#   • set / unset / validate are STRICT — a bad key or value exits non-zero and writes NOTHING.
#   • get / list / read-json are LOUD-BUT-NON-FATAL — a malformed file warns to stderr and
#     falls back to built-in defaults so `apply.sh` never hard-crashes on bad config.
#
# Config-file location override: MARKUP_MODE_CONFIG=/path/to/file.jsonc
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_CONFIG="$REPO_DIR/markup-mode.config.jsonc"
CONFIG_PATH="${MARKUP_MODE_CONFIG:-$DEFAULT_CONFIG}"

command -v python3 >/dev/null 2>&1 || { echo "config.sh: python3 is required" >&2; exit 1; }

REPO_DIR="$REPO_DIR" CONFIG_PATH="$CONFIG_PATH" python3 - "$@" <<'PY'
import json, os, re, sys

CONFIG_PATH = os.path.expanduser(os.environ["CONFIG_PATH"])
REPO_DIR = os.environ["REPO_DIR"]
args = sys.argv[1:]
cmd = args[0] if args else "list"

# ── Schema-lite: known keys (dotted), their type, and any enum. Mirrors
#    markup-mode.config.schema.json; kept here so set/validate work with zero deps.
COLOR = "color"
KEYS = {
    "accent": COLOR, "accentSoft": COLOR, "accentInk": COLOR,
    "bg": COLOR, "bg2": COLOR, "text": COLOR, "dim": COLOR,
    "border": COLOR, "focus": COLOR, "danger": COLOR,
    "font": "string", "fontScale": "scale",
    "themeFile": "string", "ns": "string", "sourcePath": "string",
    "autoTheme": "bool",
    "shortcut": "chord",
    "keymap.toggle": "chord",
    "keymap.addRef.mod": "enum:alt,shift,ctrl,meta",
    "keymap.resizeUp.key": "string",
    "keymap.resizeDown.key": "string",
    "keymap.copyRef": "chord_or_null",
    "behavior.reduceMotion": "bool",
    "behavior.themeMode": "enum:auto,light,dark",
    "behavior.showMarks": "bool",
    "behavior.openOnReveal": "bool",
}
# Built-in defaults for `list` (what the layer falls back to when a key is unset).
DEFAULTS = {
    "autoTheme": True,
    "shortcut": "mod+shift+k",
    "keymap.addRef.mod": "alt",
    "keymap.resizeUp.key": "ArrowUp",
    "keymap.resizeDown.key": "ArrowDown",
    "keymap.copyRef": None,
    "behavior.reduceMotion": False,
    "behavior.themeMode": "auto",
    "behavior.showMarks": True,
    "behavior.openOnReveal": True,
}

# Structured color forms always validate. A bare word must be a recognized CSS
# color keyword (so obvious typos like "notacolor" are rejected, while real
# names like "teal" pass). The list is the common CSS named colors + keywords.
COLOR_FUNC_RE = re.compile(r"^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\(.+\)|hsla?\(.+\))$")
CSS_COLOR_NAMES = {
    "transparent", "currentcolor", "inherit", "initial", "unset",
    "black", "silver", "gray", "grey", "white", "maroon", "red", "purple",
    "fuchsia", "magenta", "green", "lime", "olive", "yellow", "navy", "blue",
    "teal", "aqua", "cyan", "orange", "aliceblue", "antiquewhite", "aquamarine",
    "azure", "beige", "bisque", "blanchedalmond", "blueviolet", "brown",
    "burlywood", "cadetblue", "chartreuse", "chocolate", "coral",
    "cornflowerblue", "cornsilk", "crimson", "darkblue", "darkcyan",
    "darkgoldenrod", "darkgray", "darkgrey", "darkgreen", "darkkhaki",
    "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred",
    "darksalmon", "darkseagreen", "darkslateblue", "darkslategray",
    "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
    "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite",
    "forestgreen", "gainsboro", "ghostwhite", "gold", "goldenrod", "greenyellow",
    "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
    "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral",
    "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgrey", "lightgreen",
    "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
    "lightslategrey", "lightsteelblue", "lightyellow", "limegreen", "linen",
    "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple",
    "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise",
    "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
    "navajowhite", "oldlace", "olivedrab", "orangered", "orchid", "palegoldenrod",
    "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff",
    "peru", "pink", "plum", "powderblue", "rosybrown", "royalblue", "saddlebrown",
    "salmon", "sandybrown", "seagreen", "seashell", "sienna", "skyblue",
    "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue",
    "tan", "thistle", "tomato", "turquoise", "violet", "wheat", "whitesmoke",
    "yellowgreen", "rebeccapurple",
}


def warn(msg):
    print(f"config.sh: {msg}", file=sys.stderr)


def strip_jsonc(text):
    """Remove // line comments and /* */ block comments without touching string
    contents. Tolerant by design — this is the loud-but-non-fatal read path."""
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1]); i += 2; continue
            if c == '"':
                in_str = False
            i += 1; continue
        if c == '"':
            in_str = True; out.append(c); i += 1; continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            i += 2
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c); i += 1
    return "".join(out)


def load_obj(strict=False):
    """Return (obj, ok). Missing file -> ({}, True). Malformed -> ({}, False)
    with a stderr warning unless strict (then raise SystemExit)."""
    if not os.path.exists(CONFIG_PATH):
        return {}, True
    try:
        raw = open(CONFIG_PATH, encoding="utf-8").read()
    except OSError as e:
        if strict:
            warn(f"cannot read {CONFIG_PATH}: {e}"); sys.exit(1)
        warn(f"cannot read {CONFIG_PATH}: {e} — using defaults"); return {}, False
    # Tolerate a trailing comma before } or ] (common hand-edit slip).
    cleaned = re.sub(r",(\s*[}\]])", r"\1", strip_jsonc(raw))
    try:
        obj = json.loads(cleaned) if cleaned.strip() else {}
    except ValueError as e:
        if strict:
            warn(f"{CONFIG_PATH} is not valid JSONC: {e}"); sys.exit(1)
        warn(f"ignoring malformed {CONFIG_PATH}: {e} — using defaults"); return {}, False
    if not isinstance(obj, dict):
        if strict:
            warn(f"{CONFIG_PATH}: top-level must be an object"); sys.exit(1)
        warn(f"{CONFIG_PATH}: top-level must be an object — using defaults"); return {}, False
    obj.pop("$schema", None)
    return obj, True


def get_dotted(obj, key):
    cur = obj
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None, False
        cur = cur[part]
    return cur, True


def parse_chord(spec):
    """'mod+shift+k' -> {key,mod,shift,alt}. Returns dict (empty key allowed for
    modifier-only chords is rejected by the caller for shortcut)."""
    out = {}
    for tok in str(spec).split("+"):
        lc = tok.strip().lower()
        if lc in ("mod", "cmd", "command", "ctrl", "control", "meta"):
            out["mod"] = True
        elif lc == "shift":
            out["shift"] = True
        elif lc in ("alt", "option", "opt"):
            out["alt"] = True
        elif tok.strip():
            out["key"] = tok.strip()
    return out


def coerce_and_validate(key, raw):
    """Return the typed value for `key` from string `raw`, or exit 2 (no write) if invalid."""
    if key not in KEYS:
        known = ", ".join(sorted(KEYS))
        warn(f"unknown key {key!r}. Known keys:\n  {known}"); sys.exit(2)
    t = KEYS[key]
    if t == "color":
        v = raw.strip()
        if not (COLOR_FUNC_RE.match(v) or v.lower() in CSS_COLOR_NAMES):
            warn(f"invalid {key}={raw!r}: expected a CSS color (#hex, rgb()/rgba(), hsl()/hsla(), or a named color)"); sys.exit(2)
        return v
    if t == "string":
        return raw
    if t == "bool":
        lc = raw.strip().lower()
        if lc in ("true", "1", "yes", "on"):
            return True
        if lc in ("false", "0", "no", "off"):
            return False
        warn(f"invalid {key}={raw!r}: expected true/false"); sys.exit(2)
    if t == "scale":
        try:
            f = float(raw)
        except ValueError:
            warn(f"invalid {key}={raw!r}: expected a number"); sys.exit(2)
        if not (0.85 <= f <= 1.4):
            warn(f"invalid {key}={raw!r}: fontScale must be within [0.85, 1.4]"); sys.exit(2)
        return f
    if t.startswith("enum:"):
        allowed = t[len("enum:"):].split(",")
        if raw.strip() not in allowed:
            warn(f"invalid {key}={raw!r}: allowed values are {', '.join(allowed)}"); sys.exit(2)
        return raw.strip()
    if t in ("chord", "chord_or_null"):
        lc = raw.strip().lower()
        if t == "chord_or_null" and lc in ("", "null", "none", "off"):
            return None
        # Accept a JSON object literal, else a "mod+shift+k" chord string.
        if raw.strip().startswith("{"):
            try:
                obj = json.loads(raw)
            except ValueError as e:
                warn(f"invalid {key}={raw!r}: not valid JSON ({e})"); sys.exit(2)
            if not isinstance(obj, dict):
                warn(f"invalid {key}={raw!r}: chord object expected"); sys.exit(2)
            chord = obj
        else:
            chord = parse_chord(raw)
        if key in ("shortcut", "keymap.toggle") and not chord.get("key"):
            warn(f"invalid {key}={raw!r}: a toggle chord needs a key (e.g. \"mod+shift+k\")"); sys.exit(2)
        return chord
    warn(f"internal: unhandled type {t} for {key}"); sys.exit(2)


def set_dotted(obj, key, value):
    cur = obj
    parts = key.split(".")
    for part in parts[:-1]:
        if part not in cur or not isinstance(cur[part], dict):
            cur[part] = {}
        cur = cur[part]
    cur[parts[-1]] = value


def unset_dotted(obj, key):
    cur = obj
    parts = key.split(".")
    chain = []
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return False
        chain.append((cur, part))
        cur = cur[part]
    if not isinstance(cur, dict) or parts[-1] not in cur:
        return False
    del cur[parts[-1]]
    # prune now-empty parent objects we created the path through
    for parent, part in reversed(chain):
        if isinstance(parent.get(part), dict) and not parent[part]:
            del parent[part]
    return True


CANONICAL_HEADER = """\
// ─────────────────────────────────────────────────────────────────────────
// Markup Mode — pre-build settings surface
//
// ONE config file that apply.sh bakes into EVERY generated artifact's
// window.MarkupModeConfig at apply time (no runtime fetch — file:// artifacts
// stay self-contained, single-file). Set a value here once and it governs all
// future applications of the skill.
//
// Precedence (high → low):  CLI flag  >  this file  >  built-in default.
//   • An explicit apply.sh flag (--accent / --ns / --shortcut / --theme /
//     --source / --keymap) always wins for that one-off run.
//   • Anything you don't set here falls back to the built-in default.
//   • This file empty or missing == exactly today's default behavior.
//
// Two ways to change it:
//   • Hand-edit this file (// and /* */ comments are allowed and preserved).
//   • scripts/config.sh set <key> <value>   (validates, then writes,
//     preserving this header and your other keys).
//       scripts/config.sh set accent "#3b82f6"
//       scripts/config.sh set shortcut "mod+shift+j"
//       scripts/config.sh set keymap.addRef.mod shift
//       scripts/config.sh set behavior.themeMode dark
//       scripts/config.sh unset accent          # revert one key to default
//
// Run  scripts/config.sh list  to see every key and its resolved value.
// Schema (for editor autocomplete) lives in markup-mode.config.schema.json.
//
// Keys (all optional):
//   Colors:    accent accentSoft accentInk bg bg2 text dim border focus danger
//   Type:      font  fontScale (0.85–1.4)
//   Whole look: themeFile (a themes/*.json document; per-token colors above win)
//   Identity:  ns  sourcePath
//   Keys:      shortcut  keymap.toggle  keymap.addRef.mod  keymap.resizeUp.key
//              keymap.resizeDown.key  keymap.copyRef
//   Host:      autoTheme
//   Behavior:  behavior.reduceMotion  behavior.themeMode (auto|light|dark)
//              behavior.showMarks  behavior.openOnReveal
//
// The file ships intentionally empty (only $schema) so applying with it present
// reproduces today's defaults. Add only the keys you want to override.
// ─────────────────────────────────────────────────────────────────────────
"""


def existing_header(raw):
    """Return the leading // / /* */ comment + blank-line block that precedes the
    opening `{`. A hand-authored header is preserved verbatim across a `set`; if
    none is present (or the braces precede the comments), fall back to the
    canonical header so the file always ships its documentation."""
    head = []
    for ln in raw.splitlines(keepends=True):
        s = ln.strip()
        if s == "" or s.startswith("//") or s.startswith("/*") or s.startswith("*"):
            head.append(ln)
            continue
        break  # first non-comment, non-blank line ends the header
    text = "".join(head)
    return text if text.strip() else None


def write_obj(obj):
    """Rewrite the file: preserved header comment block + canonical pretty JSON.
    The data body is always valid JSON; the human-facing header survives intact
    (the actual file's header if present, else the canonical one)."""
    header = None
    if os.path.exists(CONFIG_PATH):
        try:
            header = existing_header(open(CONFIG_PATH, encoding="utf-8").read())
        except OSError:
            header = None
    if header is None:
        header = CANONICAL_HEADER
    if not header.endswith("\n"):
        header += "\n"
    # Ensure $schema is first for editor pickup, without disturbing other keys.
    ordered = {}
    if "$schema" not in obj:
        ordered["$schema"] = "./markup-mode.config.schema.json"
    else:
        ordered["$schema"] = obj["$schema"]
    for k, v in obj.items():
        if k != "$schema":
            ordered[k] = v
    body = json.dumps(ordered, indent=2)
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH) or ".", exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            f.write(header + body + "\n")
    except OSError as e:
        warn(f"could not write {CONFIG_PATH}: {e}"); sys.exit(1)


# ─────────────────────────── commands ───────────────────────────
if cmd in ("help", "-h", "--help"):
    print("config.sh — read/write the Markup Mode pre-build settings surface.")
    print(f"  config file: {CONFIG_PATH}")
    print("  (override with MARKUP_MODE_CONFIG=/path/file.jsonc)")
    print("")
    print("Commands:")
    print("  list                  every known key = resolved value (config over default)")
    print("  get <key>             resolved value for one key")
    print("  set <key> <value>     validate, then write the key (preserves header + other keys)")
    print("  unset <key>           remove a key (revert to built-in default)")
    print("  validate              parse + check the file (loud-but-non-fatal for apply)")
    print("  read-json             full config merged over defaults, as compact JSON")
    print("  path | init           config file path / create it from defaults if absent")
    print("  help                  this message")
    print("")
    print("Keys (dotted paths; all optional):")
    print("  Colors    accent accentSoft accentInk bg bg2 text dim border focus danger")
    print("  Type      font  fontScale (0.85-1.4)")
    print("  Theme     themeFile (a themes/*.json document; per-token colors above win)")
    print("  Identity  ns  sourcePath")
    print("  Keys      shortcut  keymap.toggle  keymap.addRef.mod  keymap.resizeUp.key")
    print("            keymap.resizeDown.key  keymap.copyRef")
    print("  Host      autoTheme")
    print("  Behavior  behavior.reduceMotion  behavior.themeMode (auto|light|dark)")
    print("            behavior.showMarks  behavior.openOnReveal")
    print("")
    print("Examples:")
    print("  config.sh set accent \"#3b82f6\"")
    print("  config.sh set shortcut \"mod+shift+m\"        # mod = Cmd/Ctrl")
    print("  config.sh set keymap.addRef.mod shift")
    print("  config.sh set behavior.themeMode dark")
    print("  config.sh unset accent")
    print("  config.sh list")
    print("")
    print("Values set here are baked into every artifact by scripts/apply.sh")
    print("(precedence: CLI flag > this config file > built-in default).")
    sys.exit(0)

if cmd == "path":
    print(CONFIG_PATH); sys.exit(0)

if cmd == "init":
    if not os.path.exists(CONFIG_PATH):
        write_obj({"$schema": "./markup-mode.config.schema.json"})
    print(CONFIG_PATH); sys.exit(0)

if cmd == "validate":
    obj, ok = load_obj(strict=False)
    if not ok:
        sys.exit(1)  # warning already emitted
    problems = 0
    # shallow well-known-key check (warn-but-continue on unknowns, per posture)
    def walk(prefix, d):
        global problems
        for k, v in d.items():
            dotted = f"{prefix}{k}"
            if isinstance(v, dict) and any(kk.startswith(dotted + ".") for kk in KEYS):
                walk(dotted + ".", v)
            elif dotted not in KEYS and dotted not in ("shortcut", "keymap"):
                warn(f"unknown key {dotted!r} (ignored)")
    walk("", obj)
    print("OK" if problems == 0 else "problems found")
    sys.exit(0 if problems == 0 else 1)

if cmd == "read-json":
    # Emit the file's config merged OVER defaults as compact JSON for apply.sh.
    # Loud-but-non-fatal: malformed file -> defaults only.
    obj, _ = load_obj(strict=False)
    print(json.dumps(obj, separators=(",", ":")))
    sys.exit(0)

if cmd == "get":
    if len(args) < 2:
        warn("usage: get <key>"); sys.exit(2)
    key = args[1]
    obj, _ = load_obj(strict=False)
    val, found = get_dotted(obj, key)
    if not found:
        if key in DEFAULTS:
            d = DEFAULTS[key]
            print("" if d is None else (json.dumps(d) if isinstance(d, (dict, list)) else d))
            sys.exit(0)
        sys.exit(3)  # unset and no built-in default surfaced here
    print(json.dumps(val) if isinstance(val, (dict, list, bool)) or val is None else val)
    sys.exit(0)

if cmd == "list":
    obj, _ = load_obj(strict=False)
    for key in list(KEYS):
        val, found = get_dotted(obj, key)
        if not found:
            if key in DEFAULTS:
                d = DEFAULTS[key]
                shown = "(default) " + ("null" if d is None else json.dumps(d) if isinstance(d, (dict, list)) else str(d))
            else:
                shown = "(unset)"
        else:
            shown = json.dumps(val) if isinstance(val, (dict, list, bool)) or val is None else str(val)
        print(f"{key} = {shown}")
    sys.exit(0)

if cmd == "set":
    if len(args) < 3:
        warn("usage: set <key> <value>"); sys.exit(2)
    key, raw = args[1], args[2]
    value = coerce_and_validate(key, raw)  # exits 2 on bad input, no write
    obj, ok = load_obj(strict=True)        # malformed file blocks a write (don't clobber)
    set_dotted(obj, key, value)
    write_obj(obj)
    shown = json.dumps(value) if isinstance(value, (dict, list, bool)) or value is None else value
    print(f"{key} = {shown}")
    sys.exit(0)

if cmd == "unset":
    if len(args) < 2:
        warn("usage: unset <key>"); sys.exit(2)
    key = args[1]
    obj, ok = load_obj(strict=True)
    removed = unset_dotted(obj, key)
    if removed:
        write_obj(obj)
        print(f"{key} unset (reverts to built-in default)")
    else:
        print(f"{key} was not set")
    sys.exit(0)

warn(f"unknown command {cmd!r}. Try: help | get | set | unset | list | read-json | path | init | validate")
sys.exit(2)
PY
