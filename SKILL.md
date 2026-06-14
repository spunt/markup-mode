---
name: markup-mode
description: Add a frontend-only review/markup layer to any HTML artifact, Markdown document, or live UI so a reviewer can anchor comments to specific text or specific elements, then compile them into tagged Markdown for an agent to act on. Use when the user wants to "mark up this page", "add a review/comment layer", "annotate this artifact", "leave feedback on specific parts", invokes "markup mode", or wants unambiguous, location-anchored notes handed back as Markdown. Applied in one command (scripts/apply.sh) to any rendered HTML or Markdown artifact — or by hand as a fallback; it writes a markup-enabled copy, needs no backend, and never changes the host's own content.
---

# Markup Mode

Markup Mode is a single, self-contained block of HTML/CSS/JS that turns any web page into a
reviewable surface. A reviewer starts Markup Mode, then:

- **selects text** → the selection snaps to word boundaries, is highlighted in place, and the exact quote is captured (good for commenting on a specific claim or sentence), or
- **clicks an element** → a numbered mark + outline labels it unambiguously (good for design notes on a card, chart, button, etc.).

Notes accumulate in a collapsible dock and **compile to tagged Markdown** (with a human "Where", the exact quote or a CSS selector, and the comment) that is copied or exported as a `.md` file to hand to an agent. Everything is client-side: notes live in `localStorage`; nothing is written to the host's content and no server is involved.

## When to use

- The user wants to review an agent-produced document/artifact and leave precise, per-claim feedback.
- The user wants to give design notes on specific components of a live UI.
- The user is building a new HTML artifact and wants a built-in review affordance.
- The user says "markup mode", "add a comment/review layer", "annotate", "let me flag specific parts", or wants location-anchored notes to pass back to an agent.

## When NOT to use

- A persistent, multi-user, or queryable feedback backend is required (SQLite + endpoints + a triage UI) → that is a heavier, server-backed tool, not this.
- Non-HTML targets (native apps, PDFs, images).
- Simple "add a feedback button that POSTs somewhere" — Markup Mode hands back Markdown, not a server round-trip.
- **Client-rendered app shells** — pages whose `<body>` is built at load by a JavaScript bundle rather than shipped as static HTML: **Databricks notebook exports**, Next.js/Nuxt/Angular/React SPA exports, or any "empty `<div id="root">` + bundle" page. The host's own JS replaces the body after load, discarding the injected layer — so the marks never appear. `scripts/apply.sh` **detects and refuses these by default** with an explanation (`--force` overrides). To review one anyway, open it in a browser, let it render, **Save Page As → "Webpage, Complete"**, and apply Markup Mode to that static snapshot — or export the source as Markdown and use the one-command `.md` route.

## How to apply it to a target

**Fast path (default) — one command.** Use the bundled applier. It splices the layer, writes the markup-enabled copy to the **current working directory**, records the **original** artifact's path in the compiled `Source:` line, and runs a static self-check — all in one round:

```
scripts/apply.sh <target.html> [--accent "#hex"] [--ns name] [--out DIR] [--source PATH]
```

- Output defaults to `./<base>.markup.html` — the original is never touched.
- `--source` defaults to the original target's absolute path, so a reviewer who opens the copy still exports `Source: <original>`. Override only when the doc will be served from a different real path.
- The applier's closing **static self-check** (block present, closing-`</body>` count preserved by the splice, host bytes intact, config echoed) is the default verification tier — see *Verifying* below.

Keep narration terse on this routine path: run the command, report the self-check result, stop. No step-by-step play-by-play unless the user asks to be walked through it.

**Markdown — one command (same fast path).** Point the applier straight at a `.md`/`.markdown` file and it does the whole route itself: renders the doc to a self-contained HTML preview, fills `assets/templates/markdown-host.html`, splices the review layer, writes `./<name>.markup.html` to CWD with `Source:` = the **original** `.md`'s absolute path, and runs the same static self-check.

```
scripts/apply.sh doc.md [--safe] [--md-engine pandoc|node|python] [--accent "#hex"] [--ns name] [--out DIR] [--source PATH]
```

- **Converter:** auto-detect prefers **pandoc** (`pandoc -f gfm -t html`, best GFM fidelity) → falls back to **node** (`npx --yes marked --gfm`). `--md-engine` forces one. **python** (`python3 -m markdown`) is reachable **only** via `--md-engine python` and prints a one-line *reduced GFM fidelity* warning (task lists render as literal `[ ]`, bare URLs aren't autolinked). The applier always prints which engine it used. If no usable converter exists for the selected engine, it exits non-zero with an install hint (`brew install pandoc`, or use Node).
- **Raw HTML:** passed **through by default** (you trust your own doc). `--safe` does a best-effort post-render strip of `<script>`/`<style>` blocks, inline `on*=` handlers, and `javascript:`/`data:text/html` URLs — for locally-trusted review, **not** a security boundary.
- **Title:** first `# H1` in the doc, else the filename stem (HTML-escaped).
- **Front-matter:** a leading YAML `---…---` block is stripped only when `---` is the very first line; a mid-doc `---` thematic break is preserved.
- **Relative links/images** are rewritten to absolute, URL-encoded `file://` URLs anchored at the source `.md`'s directory, with query/fragment preserved. Pure fragment `#…`, scheme, protocol-relative `//…`, and filesystem-absolute `/…` refs are left untouched. Note: `file://` rewriting **binds images to this machine** — a future `--embed-images` flag would inline them for portability. Anchoring/review itself does not need images to resolve.

**Markdown — manual 3-step fallback** (no python3, or to understand the render→fill→splice flow):
1. Render the `.md` to an HTML fragment (no `<html>/<head>/<body>` wrapper).
2. Drop it into the content slot of `assets/templates/markdown-host.html` and set its `<title>`; save as `<name>.preview.html`.
3. `scripts/apply.sh <name>.preview.html --source /abs/path/to/<name>.md` — so `Source:` points at the original `.md`, not the preview.

Other artifact types (PDF, images, plain text) are backlog — see `references/open-items.md`.

**No-shell manual splice (any target)** — when no shell is available, or to understand the splice: open `assets/templates/markup-mode.html`, copy everything **between the two `MARKUP MODE - copy from here / to here` markers** (both `<style>` elements + the `<script>`), paste it immediately before the target's closing `</body>` tag, and add `<script>window.MarkupModeConfig = { sourcePath: "<original path>" };</script>` just before it. Do not modify the host's existing markup. For a brand-new artifact you are authoring, bake the block in before `</body>` from the start.

**Theme it to the host (optional).** The layer reads seven `--mm-*` variables and **auto-detects** common host `:root` tokens (`--accent`, `--bg`, `--text`, `--border`, …). Override any color — plus namespace, toggle shortcut, and the Source path — via `MarkupModeConfig` (or `apply.sh --accent`), with no source editing. Skip it and neutral light/dark defaults are used. See `references/adaptation.md` for the mapping recipe and full config schema. (Namespace + source name otherwise auto-derive from the filename; localStorage key is `markup-mode:<filename>`.)

> **Agent cue — act on this:** when a user asks to change any Markup Mode preference or keybinding ("set the markup-mode accent to #6366f1", "rebind the toggle to Ctrl+Shift+M", "default to dark mode"), run **`scripts/config.sh set <key> <value>`** — it validates and writes the one config file that governs all future applications. Offer it proactively if they mention wanting a persistent look/shortcut. (`scripts/config.sh help` lists every key.) For a one-off on a single artifact, pass the matching `apply.sh` flag instead.

**One settings file for every application (`markup-mode.config.jsonc`).** To set defaults **once** that apply to **all** future applications (not per-artifact), edit the repo-root `markup-mode.config.jsonc`. `apply.sh` reads it as the default source for `--accent`/`--ns`/`--shortcut`/`--theme`/keymap/behavior and bakes the resolved values in at apply time. **Precedence: CLI flag > config file > built-in default** (per key); the file ships empty so present-with-defaults == today's behavior; a missing/malformed file is loud-but-non-fatal (warn + fall back, never crash apply). An agent should **honor it** (read with `scripts/config.sh list`) and **update it on explicit request** with the validated, comment-preserving writer:

```
scripts/config.sh set accent "#6366f1"      # validate + write (preserves the header & other keys)
scripts/config.sh set keymap.addRef.mod shift
scripts/config.sh set behavior.themeMode dark
scripts/config.sh unset accent              # revert one key to default
scripts/config.sh list                      # show every key = resolved value
```

`set`/`unset` are strict (bad input exits non-zero, writes nothing). `apply.sh` also takes `--keymap KEY=CHORD`, `--config PATH`, and `--no-config`. Full key table + schema: `references/adaptation.md` §0a.

## Verifying (tiered — fast by default)

- **Default — static (one round, no browser).** Trust the applier's static self-check. The layer ships a comprehensive regression suite (`tests/regression.js`), so its *behavior* is already proven; the only per-application risks — injection correctness and theme clash — are statically checkable.
- **Escalate to a headless browser check only when the layer source was modified or a custom theme was applied** — the cases static checks can't cover. Do the whole check in **one** `browser_evaluate` returning a single object (mount + a text-selection note + an element-mark note + Compile output), not several round-trips.
- **Force it any time** by asking ("verify in a browser", "full verification") or running `apply.sh --verify full`.
- For a headless check, serve the file (`python3 -m http.server`) — Playwright blocks `file:`; for a human glance, `open <file>`.
- The full manual checklist lives in `test_cases.md`.

## Runtime behavior (what the reviewer gets)

- **Enter/exit:** the dock's "Start Markup Mode" button or `Cmd/Ctrl+Shift+K` (configurable); `Esc` exits (or closes an open note first, or clears the selected note).
- **Text anchor:** drag-select → popup beside the selection → type → Save. Draft text is persisted on every keystroke, so clicking away never loses it. The popup is titled **"New note"** with **Discard / Save note**.
- **Element anchor:** hover/click runs through an intent resolver that prefers real controls, semantic/component boundaries, and prose blocks over anonymous wrapper nodes; `↑/↓` grows/shrinks along that meaningful target chain; click → popup → Save. A persistent outline + compact unnumbered mark label it. In Markdown previews, clicking prose blocks (`p`, `li`, headings, `blockquote`, `pre`) creates a whole-block **text** anchor instead of a generic element anchor, while links/images/tables/controls stay element targets.
- **Navigate vs. edit (select-then-edit):** a *single* click on a mark or a dock row **reveals + selects** the note — its anchor scrolls into view and it gets a persistent active highlight (it does *not* open the editor and does not arm comment mode, so you can browse freely). Minimized marks remain clickable; the **Open dock on reveal** preference controls whether revealing a mark also expands the dock. To **edit**, double-click the mark or row, or click the row's **✎** button; the popup is then titled **"Editing · Note N"** with **Cancel / Save**. Deleting (the row's **✕**) shows an **Undo** toast for a few seconds.
- **Cross-references:** while a note is open, hold **⌥ Alt/Option** and **click an element** (or **⌥-drag** to select a run of text) to insert a concise `[ref: <selector or "quote">]` token into the note text at the cursor (text refs carry the full quote, untruncated). The dashed candidate outline only appears while the add-reference modifier is held. A plain click, plain double-click, or plain selection while the popup is open is a no-op — the Alt modifier is what distinguishes adding a reference from the browser's own click/word-select. Copy-ref support copies that token to the clipboard instead of leaving a note when enabled; the default visible workflow is inline Alt insertion. The add-reference modifier is configurable (`keymap.addRef.mod`).
- **Hover to view:** hovering a mark's pin (when comment mode is off) shows a floating tooltip with the note text — so shared/exported files can be browsed without entering comment mode.
- **Dock:** opens as a **right rail** by default; the minimize glyph collapses it to a bottom-right pill. Drag the header to move when floating; resize from the corner in float mode or the rail grip in docked mode. The dock header shows direct position buttons (float / dock-left / dock-right) — click one to move there immediately. On wide screens a rail reserves a resizable column so the page is not covered; below the compact breakpoint it spans the viewport and clears body margins so overlaid marks continue to line up with the page. Minimizing a rail schedules a follow-up reposition after the page margin settles.
- **Sort marks:** a **sort control** in the dock lets you order marks by **Created** (default — insertion order), **Document order** (DOM position), or **Manual** (drag-reorder dock rows). Dock row ordinals, edit headers, and compiled `.md` headings reflect the active sort order. On-page marks are intentionally unnumbered so transient sort order does not obstruct or imply stable document identity. Internal note ids are stable regardless of sort.
- **Keyboard / a11y:** the notes list is a `role="list"` with roving arrow-key focus (`↑/↓`, `Enter` reveals); the popup is a focus-trapped `role="dialog"` that restores focus on close; toasts announce via an ARIA live region.
- **Output:** A **Show Compiled / Hide Compiled** toggle reveals a read-only Markdown preview generated from the notes. **Copy** is visible only while compiled is shown; **Export .md** is always present (disabled when there are no notes). While the compiled view is open, the preview **auto-updates** on every note add, edit, delete, or sort change.
- **Export reviewed HTML:** a button beside **Export .md** downloads a self-contained `<name>.reviewed.html` — the same artifact with the current notes baked into an embedded `<script type="application/json" id="mm-notes">` block. **Opening it anywhere rehydrates the review** (marks, dock rows, highlights), so the file itself becomes the shareable container — email it, reopen it on another machine, hand it to a second reviewer. The export is a **clean snapshot** (runtime dock/overlay/popup nodes and any rail body margins are stripped before saving), so re-opening mounts the layer exactly once and re-exporting replaces the notes block rather than stacking it. This is **complementary to Export .md**: the `.md` is the agent task-list handback (the deliverable to action); the reviewed HTML preserves full context for human re-sharing and multi-session review. **Seed-on-mount precedence:** on open, if `localStorage` already has notes for this namespace it **wins** (a returning reviewer's in-session edits are never clobbered); the baked block is used only as the fallback for a freshly-opened shared file. Re-export to share new edits. (A shared file can't be rewritten in place — Export reviewed HTML always downloads a new copy.)
- **Settings / preferences:** the gear opens Appearance and Behavior controls. Appearance supports auto/light/dark theme, reduce motion, accent picker/swatches, and a live contrast readout. Behavior currently includes **Show marks** and **Open dock on reveal**. Preferences persist per namespace and still respect `MarkupModeConfig` color overrides.
- **Copy-ref confirmation:** in Copy-ref mode, the confirmation appears as a small **pointer chip** (near the click point or selection end) instead of the corner toast; the corner toast continues to serve all other messages (inserts, exports, deletes).

## Compiled Markdown contract

```
# Feedback — <document title> (review)
Source: <full path to the artifact> · N notes · YYYY-MM-DD
How to apply each note: its Locator is the surrounding text with the exact edit span wrapped in ⟪ ⟫. Find that span in the artifact — whitespace and markup may differ from this rendered text, so match on the words, not byte-for-byte. If it resolves to exactly one place, act on it (edit only what was inside ⟪ ⟫); if it resolves to zero or several places, do not guess — report that note as unresolved. Quote repeats the span alone; Before/After give the same context separately. The Selector is a stale positional hint and may be wrong; never use it to choose between repeated lines.
Assumptions: you have the original artifact named in Source: above (this Markdown is the deliverable, not any *.markup.html); the Source path was captured on the reviewer's machine.

## Note 1 · text
Where: <human breadcrumb, e.g. Main › §"Section" › p.lead "first words…">
Quote: "the exact selected text"
Locator: "≤32 chars before⟪the exact selected text⟫≤32 chars after"
Before: "≤32 chars of preceding context"
After: "≤32 chars of following context"
Selector (hint): <css path>
Comment:
> the reviewer's note (one or more lines)

## Note 2 · element
Where: <breadcrumb>
Quote: "the element's visible text (whitespace-collapsed, capped ~200 chars)"
Selector (hint): <css path>
Comment:
> …

---
N notes · in-page review · paste to an agent to action
```

**Handback — Locator + uniqueness gate.** Each text note carries a `Locator`: its ≤32-char `Before`/`After` context fused around the `Quote`, with the exact edit span delimited by `⟪ ⟫` (the W3C/Hypothesis `TextQuoteSelector` pattern, made self-contained). The receiving agent should **find that span in the artifact and act only when it resolves to exactly one location** — the surrounding context is what disambiguates an otherwise-repeated `Quote`, so a unique match is safe to edit even when the quote alone occurs on several identical sibling lines. The match is **word-level, not byte-literal**: the `Locator` is built from whitespace-collapsed *rendered* text, so the original source (markdown syntax, HTML tags, line breaks) will differ — match on the words, not character-for-character. If the span resolves to **zero or more than one** location, the agent should **report the note as unresolved rather than guess**, and never use `Selector (hint)` (a stale positional pointer) to break a tie. `Quote` and `Before`/`After` are still emitted separately as the durable fallback anchors. Element notes carry `Quote` + `Selector (hint)` only (no `Locator`, since they have no surrounding text span). This refuse-on-ambiguity discipline was validated by an autoresearch optimization loop (HARD-stratum refusal 0.60→0.04, miswire 0; generalized to held-out fixtures) — see `docs/handback-validation.md`. Two assumptions are stated inline in the header: the agent has the original artifact named in `Source:` (this `.md` is the deliverable for an agent to action — for human re-sharing of the full review, use **Export reviewed HTML**, which bakes the notes into the file so they travel with it), and the `Source` path was captured on the reviewer's machine, so it may need re-resolving elsewhere. Legacy notes saved before this format degrade gracefully (quote only, no `Locator`/`Before`/`After`).

## Resources

- `markup-mode.config.jsonc` — the one pre-build settings file (repo root) that `apply.sh` bakes into every artifact; edit by hand or via `scripts/config.sh`. `markup-mode.config.schema.json` is its JSON Schema (editor autocomplete). `scripts/config.sh` is the validated get/set tool; `scripts/mm_build_config.py` merges it under the flags at apply time.
- `assets/templates/markup-mode.html` — the canonical layer, embedded in a runnable demo page. Copy the block between the markers. Open the file directly to see it working.
- `references/adaptation.md` — theming/auto-detection, the `window.MarkupModeConfig` schema, breadcrumbs, namespacing, new-vs-existing embedding.
- `references/architecture.md` — how the layer works internally (overlay, CSS Custom Highlight API, anchor/visual model + offset serialization, sticky popup, rail-as-column, active-note state, undo-toast, a11y). Read before modifying the layer.
- `references/open-items.md` — known limitations and backlog.
- `tests/regression.js` — headless Playwright regression suite covering the scenarios in `test_cases.md`, the one-command Markdown route (`apply.sh doc.md`), and the Export reviewed HTML round-trip + seed-on-mount precedence. Run `node tests/regression.js` after any change to the layer or applier.
