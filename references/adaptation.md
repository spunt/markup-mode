# Adapting Markup Mode to a host

The layer ships working out of the box. These are the (small) adjustments that make it feel native
to a particular page. Only theming is usually worth doing; the rest is automatic.

## 0. Quick config — `window.MarkupModeConfig` (no source editing)

Define this object in a `<script>` **before** the Markup Mode block to configure the layer without
touching its source:

```js
window.MarkupModeConfig = {
  ns:         "markup-mode:my-artifact",     // localStorage namespace (share one note set across URLs)
  sourcePath: "/abs/path/to/artifact.html",  // the compiled "Source:" line (e.g. real FS path when served over http)
  accent:     "#6366f1",                     // --mm-accent (also: accentSoft, accentInk, bg, bg2, text, dim, border, focus, danger)
  shortcut:   { key: "k", mod: true, shift: true, alt: false }, // toggle; mod = Cmd/Ctrl. Default: Cmd/Ctrl+Shift+K
  theme:      { accent:"#6366f1", font:"Georgia, serif", fontScale:1.1 }, // a whole look in one object (see §1b)
  autoTheme:  true                           // default true; set false to disable host-token sniffing
};
```

Every key is optional; omitted keys fall back to the built-in defaults, and with no object at all
the layer behaves exactly as before. (The on-screen shortcut hint still reads "⌘⇧K" even under a
custom `shortcut` — a known cosmetic limitation.)

`window.MarkupModeConfig` also accepts:

- **`keymap`** — rebind keys without editing source: `keymap.toggle` (alias of `shortcut`),
  `keymap.addRef.mod` (`alt`|`shift`|`ctrl`|`meta`), `keymap.resizeUp.key`/`keymap.resizeDown.key`,
  and `keymap.copyRef` (a chord, or `null` to disable). Runtime precedence stays
  `BUILTIN_KEYMAP < CFG.shortcut(toggle) < CFG.keymap < PREFS.keymap`.
- **`prefs`** — initial runtime preferences seeded into per-namespace `localStorage` on first open:
  `reduceMotion`, `themeMode` (`auto`|`light`|`dark`), `showMarks`, `openOnReveal`. These seed only
  where the reviewer has no stored preference yet — a returning reviewer's saved choice always wins
  (same seed-on-mount precedence as notes).

## 0a. One settings file for all applications — `markup-mode.config.jsonc`

`window.MarkupModeConfig` configures **one artifact**. To set defaults **once** that apply to
**every** artifact you produce with `scripts/apply.sh`, edit the repo-root **`markup-mode.config.jsonc`**.
`apply.sh` reads it as the default source for `--accent`/`--ns`/`--shortcut`/`--theme`/keymap/behavior
and **bakes** the resolved values into each artifact's `MarkupModeConfig` at apply time (no runtime
fetch — `file://` artifacts stay self-contained single files).

**Precedence (high → low): CLI flag > config file > built-in default**, resolved per key. An explicit
flag still wins for a one-off run; anything unset falls back to the built-in default. The file ships
**empty** (only `$schema`), so applying with it present reproduces today's behavior exactly. A missing,
empty, or malformed file is **loud-but-non-fatal** — `apply.sh` warns to stderr and falls back to
defaults; it never hard-crashes on bad config.

It is **JSONC** (a `.jsonc` with an annotated header and `//` / `/* */` comments) and carries a
`$schema` pointing at `markup-mode.config.schema.json` for editor autocomplete/validation. Two ways
to change it:

- **Hand-edit** the file. Uncomment a key and set it. Comments are preserved.
- **`scripts/config.sh`** — validated, comment-preserving get/set for a human or an agent:

  ```bash
  scripts/config.sh list                      # every key = resolved value (config over default)
  scripts/config.sh get accent                # one resolved value
  scripts/config.sh set accent "#6366f1"      # validate, then write (preserves header + other keys)
  scripts/config.sh set shortcut "mod+shift+j"
  scripts/config.sh set keymap.addRef.mod shift
  scripts/config.sh set behavior.themeMode dark
  scripts/config.sh unset accent              # revert one key to the built-in default
  scripts/config.sh path | init | validate    # file path / create if absent / parse-check
  ```

  `set`/`unset`/`validate` are **strict** — a bad key or value exits non-zero and writes nothing, so
  an automated edit can't corrupt the file. `get`/`list` are loud-but-non-fatal. Override the file
  location with `MARKUP_MODE_CONFIG=/path/file.jsonc`.

**Keys** (all optional; dotted paths for nested values):

| Key | Bakes into | Notes |
|---|---|---|
| `accent` … `danger` (10 color tokens) | `theme.*` + `accent` | `accent accentSoft accentInk bg bg2 text dim border focus danger` (the seven `--mm-*` + ink/focus/danger). |
| `font`, `fontScale` | `theme.font`, `theme.fontScale` | Chrome only; compiled box stays monospace. `fontScale` clamped 0.85–1.4. |
| `themeFile` | `theme` (inlined) | A `themes/*.json` document; relative paths resolve from the config file's dir. Per-token color keys above win over the doc. |
| `ns`, `sourcePath` | `ns`, `sourcePath` | `sourcePath` is normally left unset so each target reports its own path. |
| `shortcut` | `shortcut` | Chord string `"mod+shift+k"` or object `{key,mod,shift,alt}`. |
| `keymap.toggle` / `keymap.addRef.mod` / `keymap.resizeUp.key` / `keymap.resizeDown.key` / `keymap.copyRef` | `keymap` | Key rebinding. |
| `autoTheme` | `autoTheme` | Default true; set false to disable host-token sniffing. |
| `behavior.reduceMotion` / `behavior.themeMode` / `behavior.showMarks` / `behavior.openOnReveal` | `prefs` | Initial runtime prefs seed (see `prefs` above). |

`apply.sh` adds matching flags: **`--keymap KEY=CHORD`** (repeatable; `KEY` is
`toggle`|`addRef`|`resizeUp`|`resizeDown`|`copyRef`), **`--config PATH`** (use a different settings
file), and **`--no-config`** (ignore the file entirely — built-in defaults + flags only).

## 1. Theme — map colors to the host's tokens

The layer reads every color from seven CSS variables declared in a `:root` block at the top of the
first `<style id="mm-style">`:

```css
:root{
  --mm-accent:#4f46e5; --mm-accent-soft:rgba(99,102,241,.16);
  --mm-bg:#ffffff; --mm-bg2:#f1efea; --mm-text:#23201b; --mm-dim:#6b6256;
  --mm-border:rgba(40,38,32,.22);
}
@media (prefers-color-scheme: dark){ :root{ --mm-accent:#818cf8; --mm-bg:#23262d; --mm-bg2:#2d313a; --mm-text:#e8e4dc; --mm-dim:#b6b0a4; --mm-border:rgba(232,228,220,.22); --mm-accent-soft:rgba(129,140,248,.20); } }
```

| Variable | Used for | Map to the host's… |
|---|---|---|
| `--mm-accent` | marks, highlight underline, primary buttons, active states | brand/accent token (a saturated **indigo/violet** reads well as an annotation signal even if the brand color differs) |
| `--mm-accent-soft` | highlight fill, soft backgrounds | an `rgba()` of the accent at ~15–22% |
| `--mm-bg` | dock/popup surface | primary surface / panel background |
| `--mm-bg2` | row hover, inner fields, secondary buttons | secondary surface |
| `--mm-text` | text | body text color |
| `--mm-dim` | secondary text, labels | muted text color |
| `--mm-border` | borders | hairline/rule color |

**Recipe:** point each variable at the host token, keeping the literal as a fallback. Example, against a host whose `:root` defines `--brand`, `--bg-alt`, `--rule`, `--text-2`:

```css
:root{
  --mm-accent: var(--brand, #4f46e5);
  --mm-accent-soft: rgba(99,102,241,.18);
  --mm-bg: var(--bg-alt, #fff);
  --mm-bg2: var(--bg, #efefef);
  --mm-text: var(--text, #23201b);
  --mm-dim: var(--text-2, #6b6256);
  --mm-border: var(--rule, rgba(40,38,32,.22));
}
```

**Auto-detection (on by default).** Before you map anything by hand, the layer sniffs the host's
`:root` for common token names and adopts the first match for each slot:
`--mm-accent` ← `--accent`/`--accent-color`/`--color-accent`/`--brand`/`--primary`; `--mm-bg` ←
`--bg`/`--background`/`--surface`; `--mm-text` ← `--text`/`--fg`/`--foreground`; `--mm-border` ←
`--border`/`--rule`/`--divider`; plus `--mm-bg2`/`--mm-dim` equivalents. So a host that already
exposes design tokens themes itself with **no edits**. Explicit `MarkupModeConfig` colors win over
auto-detection; set `autoTheme:false` to disable sniffing entirely. (`--mm-accent-soft` is never
auto-sniffed — set it explicitly if the default translucent accent doesn't suit.)

How to find the host's tokens manually: search its CSS for `:root` and `--`. Prefer a surface token
for `--mm-bg`, the rule/border token for `--mm-border`, and an accent for `--mm-accent`. If the host
has no custom properties, leave the defaults — they already handle light and dark via
`prefers-color-scheme`.

Typography: the dock uses a neutral `system-ui` stack via `var(--mm-font, …)`. Set `font` (and an
optional `fontScale`, clamped 0.85–1.4) in `MarkupModeConfig.theme` or a `--theme` document (§1b) to
restyle the chrome — the compiled-markdown box always stays monospace.

## 1b. `apply.sh` flags & theme documents

`scripts/apply.sh` bakes config into the generated artifact at apply time (no runtime fetch — the
output stays a self-contained single file that works from `file://`):

| Flag | Effect |
|---|---|
| `--accent "#6366f1"` | sets `MarkupModeConfig.accent` (`--mm-accent`). |
| `--ns NAME` | localStorage namespace (share one note set across URLs). |
| `--shortcut "mod+shift+k"` | toggle chord baked into `MarkupModeConfig.shortcut` (`mod` = Cmd/Ctrl). |
| `--theme FILE.json` | inlines a theme document into `MarkupModeConfig.theme` (below). |
| `--keymap KEY=CHORD` | rebind one key (repeatable). `KEY` ∈ `toggle`/`addRef`/`resizeUp`/`resizeDown`/`copyRef`. |
| `--config PATH` | use a specific settings file instead of the repo-root `markup-mode.config.jsonc`. |
| `--no-config` | ignore the settings file entirely (built-in defaults + flags only). |

Every flag **defaults to the value in `markup-mode.config.jsonc`** (see §0a) and overrides it when
given. So one config file governs all uses; a flag is the per-run exception. Precedence:
**flag > config file > built-in default**, baked at apply time (no runtime fetch).

**Theme document** (`themes/*.json`) — one editable file per look. Every key is optional and falls
back to the built-in default. Ships with `themes/paper.json` (warm light serif) and
`themes/sound-dark.json` (cool dark) as starting points:

```json
{
  "accent": "#8a6d3b", "accentSoft": "rgba(138,109,59,0.16)", "accentInk": "#6b5328",
  "bg": "#faf6ee", "bg2": "#efe7d6", "text": "#2b2419", "dim": "#6f6553",
  "border": "rgba(43,36,25,0.22)", "focus": "#6b5328", "danger": "#9c3328",
  "font": "Georgia, 'Iowan Old Style', serif", "fontScale": 1.05
}
```

`font` → `--mm-font` (chrome only; the compiled box stays monospace). `fontScale` multiplies the
`--mm-fs-*` type ramp (clamped 0.85–1.4); or set `fsXs`/`fsSm`/`fsBase`/`fsMd` explicitly. Apply with
`scripts/apply.sh artifact.html --theme themes/paper.json`. The same keys also work live in the
in-panel **Settings -> Appearance** pane (light/dark/auto, reduce motion, accent picker/swatches,
and a live WCAG contrast readout).

> **Rebinding the add-reference modifier.** Secondary `[ref: …]` anchors use **Alt/Option** by
> default. Change it from the settings file (`scripts/config.sh set keymap.addRef.mod shift`), per-run
> (`apply.sh --keymap addRef=shift`), or in embedded code (`MarkupModeConfig.keymap.addRef.mod`). Plain
> click, double-click, or selection while a note is open remains inert so the browser's native
> selection behavior wins. The deferred *in-UI* key-rebind panel is still tracked in
> `references/open-items.md` (the settings file covers the pre-build case).

## 2. The "Where" breadcrumb — host-agnostic by default

Each note's human-readable location is built from:

- **Region** — the nearest landmark ancestor: `main`, `aside`, `nav`, `header`, `footer`, or an
  element with a matching `role`/`aria-label`. Labeled by `aria-label` if present, else a friendly
  name (Main/Side/Nav/Header/Footer) or `#id`.
- **Section** — the nearest `section`/`article`/`[role="region"]`'s heading (`h1`–`h6`), falling
  back to the nearest preceding heading in document order.
- **Self** — the element's tag, first class, and a short text snippet.

This works on any reasonably structured page **with no edits**. To get richer breadcrumbs on a page
that uses `<div class="section-head">`-style pseudo-headings instead of real `<h*>`, you can either
add real headings to the host, or extend `sectionOf()` in the layer to also recognize the host's
heading class. The machine-actionable `Selector` and `Quote` do not depend on this.

## 3. Namespace & source — automatic

`SRC` and the localStorage namespace `NS` are derived at runtime from the page's filename
(`location.pathname`):

```js
var SRC = (location.pathname.split("/").pop() || "page").replace(/[#?].*$/,"");
var NS  = "markup-mode:" + (SRC || "page");
```

Notes for `report.html` are stored under `markup-mode:report.html`, independently from other pages.
You normally don't touch this. To share one note set across multiple URLs, set
`MarkupModeConfig.ns` to a stable string (preferred over editing source).

The compiled **`Source:`** line shows the artifact's **full path** — `location.pathname` for a
locally-opened `file://` artifact (e.g. `/path/to/report.html`), or `host`+`pathname` when served
over http. Override it with `MarkupModeConfig.sourcePath` (handy when a page is served over http but
you want the real filesystem path handed to the agent).

The **export filename** is `<base>-markedup-<timestamp>.md`, where `<base>` is the filename without
extension, or — when that is generic (`index`, `home`, `page`, …) — a slug of `document.title`.
Give the page a meaningful `<title>` and exports name themselves well.

## 4. Embedding: new artifact vs. existing page

- **New artifact you are authoring:** paste the block before `</body>` as you build. It is inert
  until the reviewer turns comment mode on, so it never interferes with normal use.
- **Existing page:** work on a **copy** (e.g. `page.markup.html`) and paste the block before
  `</body>`. Keep all of the host's own `<script>`/`<style>` above it untouched. The layer only
  attaches global listeners for its shortcut and (cheap, passive) scroll/resize; per-interaction
  listeners exist only while comment mode is on, so it does not disturb the host's own handlers.

## 5. Removing it

Delete the pasted block (both `<style>` elements + the `<script>`). The page returns to its exact
original bytes. Reviewer notes remain in `localStorage` until the reviewer clicks "Clear all" or the
browser data is cleared.
