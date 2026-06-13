#!/usr/bin/env python3
"""Build the window.MarkupModeConfig object body for apply.sh.

Reads the merged settings-file JSON plus the explicit CLI-flag values from the
environment, applies precedence (CLI flag > config file > built-in default), and
prints a single-line JS object body (no enclosing braces) to stdout. apply.sh
wraps it as `window.MarkupModeConfig = { <body> };`.

Precedence is per key. The settings file supplies defaults for accent / colors /
font / ns / sourcePath / shortcut / keymap / theme(File) / autoTheme / behavior;
an explicit flag overrides only that key for the one-off run.

Loud-but-non-fatal: a bad themeFile or unreadable theme document warns to stderr
and is skipped (apply still produces a valid artifact) — apply must never crash
on bad config. An explicit --theme flag is validated by apply.sh before this runs.
"""
import json
import os
import sys

env = os.environ.get


def warn(msg):
    print(f"mm_build_config: {msg}", file=sys.stderr)


def load_config():
    raw = env("MM_CONFIG_JSON", "{}") or "{}"
    try:
        obj = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(obj, dict):
        return {}
    obj.pop("$schema", None)
    return obj


def parse_chord(spec):
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


def load_theme_doc(theme_file, base_dir):
    """Resolve a theme document path (absolute, or relative to base_dir) and
    return its parsed object, or None (with a warning) if unreadable/invalid."""
    if not theme_file:
        return None
    path = theme_file
    if not os.path.isabs(path):
        path = os.path.join(base_dir, path)
    if not os.path.isfile(path):
        warn(f"theme file not found: {theme_file} — skipping")
        return None
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError) as e:
        warn(f"theme file is not valid JSON: {theme_file} ({e}) — skipping")
        return None
    return doc if isinstance(doc, dict) else None


COLOR_KEYS = ["accent", "accentSoft", "accentInk", "bg", "bg2", "text", "dim", "border", "focus", "danger"]
TYPE_KEYS = ["font", "fontScale"]


def main():
    cfg = load_config()
    base_dir = env("MM_CONFIG_DIR", os.getcwd())
    out = {}

    # sourcePath: apply.sh always passes a resolved MM_SOURCE (the original target's
    # absolute path, or --source / the config's sourcePath as default it already folded in).
    source = env("MM_SOURCE", "")
    if source:
        out["sourcePath"] = source
    elif cfg.get("sourcePath"):
        out["sourcePath"] = cfg["sourcePath"]

    # accent: flag > config.accent. This resolved value must win EVERYWHERE,
    # including theme.accent below — the layer's themeVal() reads theme.accent
    # before top-level accent, so a flag override has to overwrite both.
    resolved_accent = None
    if env("MM_HAS_ACCENT"):
        resolved_accent = env("MM_FLAG_ACCENT", "")
    elif cfg.get("accent") is not None:
        resolved_accent = cfg["accent"]
    if resolved_accent:
        out["accent"] = resolved_accent

    # ns: flag > config.ns
    if env("MM_HAS_NS"):
        out["ns"] = env("MM_FLAG_NS", "")
    elif cfg.get("ns"):
        out["ns"] = cfg["ns"]

    # ---- theme object: themeFile/--theme document + inline color/type keys ----
    # Precedence inside theme: explicit per-token config color keys win over the
    # theme document for the same token (matches the layer's themeVal()).
    theme = {}
    theme_file = env("MM_FLAG_THEME", "") if env("MM_HAS_THEME") else cfg.get("themeFile", "")
    doc = load_theme_doc(theme_file, base_dir)
    if doc:
        theme.update(doc)
    for k in COLOR_KEYS + TYPE_KEYS:
        if cfg.get(k) is not None:
            theme[k] = cfg[k]
    # The resolved accent (flag > config) must win over any theme-document accent,
    # because the layer's themeVal() reads theme.accent before top-level accent.
    if resolved_accent:
        theme["accent"] = resolved_accent
    if theme:
        out["theme"] = theme

    # autoTheme: config only (no flag); emit only when explicitly false (default true).
    if cfg.get("autoTheme") is False:
        out["autoTheme"] = False

    # ---- shortcut + keymap ----
    # shortcut: flag > config.shortcut. Stored as a chord object on MarkupModeConfig.shortcut.
    shortcut = None
    if env("MM_HAS_SHORTCUT"):
        shortcut = parse_chord(env("MM_FLAG_SHORTCUT", ""))
    elif isinstance(cfg.get("shortcut"), dict):
        shortcut = dict(cfg["shortcut"])
    elif isinstance(cfg.get("shortcut"), str):
        shortcut = parse_chord(cfg["shortcut"])
    if shortcut and shortcut.get("key"):
        out["shortcut"] = shortcut

    # keymap: start from config.keymap, then overlay --keymap K=CHORD specs (flag wins).
    keymap = {}
    if isinstance(cfg.get("keymap"), dict):
        keymap = json.loads(json.dumps(cfg["keymap"]))  # deep copy
    specs = [s for s in (env("MM_KEYMAP_SPECS", "") or "").splitlines() if s.strip()]
    for spec in specs:
        if "=" not in spec:
            warn(f"ignoring --keymap {spec!r}: expected KEY=CHORD"); continue
        k, v = spec.split("=", 1)
        k = k.strip()
        v = v.strip()
        if k in ("toggle", "copyRef"):
            if k == "copyRef" and v.lower() in ("", "null", "none", "off"):
                keymap[k] = None
            else:
                ch = parse_chord(v)
                if not ch.get("key"):
                    warn(f"ignoring --keymap {spec!r}: a {k} chord needs a key"); continue
                keymap[k] = ch
        elif k in ("resizeUp", "resizeDown"):
            keymap[k] = {"key": v}
        elif k == "addRef":
            if v.lower() not in ("alt", "shift", "ctrl", "meta"):
                warn(f"ignoring --keymap {spec!r}: addRef must be alt|shift|ctrl|meta"); continue
            keymap[k] = {"mod": v.lower()}
        else:
            warn(f"ignoring --keymap {spec!r}: unknown key {k!r} (toggle|addRef|resizeUp|resizeDown|copyRef)")
    if keymap:
        out["keymap"] = keymap

    # ---- behavior -> prefs seed ----
    beh = cfg.get("behavior")
    if isinstance(beh, dict) and beh:
        out["prefs"] = beh

    # Emit a JS object body (no enclosing braces). json.dumps gives valid JS here
    # (booleans/strings/numbers/nested objects all round-trip into the <script>).
    body = json.dumps(out, ensure_ascii=False)
    inner = body[1:-1] if body.startswith("{") and body.endswith("}") else body
    sys.stdout.write(inner)
    return 0


if __name__ == "__main__":
    sys.exit(main())
