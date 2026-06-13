# Markup Mode — test cases

How to validate the layer after any change. Two tiers: a committed **automated suite** (browser-driven,
for behavior) and a quick **manual checklist** (human, for visual/UX judgment the suite can't make).

**Automated:** run `node tests/regression.js` (expect `✅ PASS — N passed, 0 failed`; the suite prints its own tally).
It boots its own static server + headless Chromium, so you don't need to serve the file by hand. It
needs Playwright + a Chromium build — if `require('playwright')` isn't resolvable, `npm i -D
playwright && npx playwright install chromium`, or point `PLAYWRIGHT_DIR` at a `node_modules` that has
it. The script is the executable source of truth for the scenarios summarized below.

For the **manual** checklist, `file://` is blocked by most drivers, so serve the file over HTTP first:

```bash
d=$(mktemp -d) && cp assets/templates/markup-mode.html "$d/index.html" \
  && (cd "$d" && python3 -m http.server 8141 --bind 127.0.0.1 &) \
  && open http://127.0.0.1:8141/index.html     # or point a headless driver at it
```

The demo's localStorage namespace is `markup-mode:index.html`.

## Manual checklist (reserve for human judgment)

- [ ] Dock opens as a right rail by default; minimize collapses it to the "Markup" pill, bottom-right.
- [ ] Start Markup Mode (button or `Cmd/Ctrl+Shift+K`); the control pulses; cursor is a crosshair.
- [ ] Drag-select part of a word → selection snaps to the whole word; popup titled **"New note"**
      with **Discard / Save note** appears beside it.
- [ ] Type a note, click elsewhere, reopen the same selection → draft text is still there.
- [ ] Save → the text stays highlighted; a mark appears; the dock count increments.
- [ ] Click an element → outline + popup; nested controls resolve to the control, card/component text resolves to the intended component boundary, and `↑/↓` grows/shrinks along meaningful ancestors/descendants before saving.
- [ ] In a Markdown-generated preview, click a paragraph/list item/heading/blockquote/code block → popup is **TEXT** with the whole block quote; click a link/image/table/control → popup remains **ELEMENT**.
- [ ] **Single-click** a mark or a dock row → the note is *revealed + selected* (scrolls into view,
      stays highlighted with an active row/mark) but the editor does **not** open — and this works with
      comment mode off.
- [ ] **Double-click** a mark/row, or click the row's **✎** → the editor opens, titled
      **"Editing · Note N"** with **Cancel / Save** (so "Discard" can't be mistaken for a real delete).
- [ ] Delete a note with the row's **✕** → an **Undo** toast appears; clicking it restores the note.
- [ ] While a note is open, **⌥ Alt/Option + click** another element → a `[ref: …]` token is inserted
      into the note; an **⌥-drag** text selection inserts its full quote (not truncated with "…").
      The dashed reference target outline appears only while Alt/Option is held. A *plain* click,
      double-click, or selection while the popup is open inserts **nothing**.
- [ ] If Copy-ref is enabled, click an element → a reference is copied to the clipboard (no new note).
- [ ] Compile → read-only Markdown preview; the **Source:** line shows the artifact's full path; Copy and
      Export both work; filename looks sensible.
- [ ] Use the direct position buttons: **float**, **left rail**, **right rail**. On wide screens the
      page shrinks beside a rail (not covered); drag the grip to resize; it stops at a min and half
      the viewport. On narrow screens the rail compacts to the viewport and clears body margins.
      Drag the floating panel to mid-screen then minimize → the pill returns to the corner and marks
      realign after the page margin settles.
- [ ] Keyboard: Tab to the notes list, `↑/↓` move between rows, `Enter` reveals; Tab reaches each
      row's ✎/✕; inside the editor, Tab cycles within the dialog and `Esc` returns focus to the row.
- [ ] Reload → notes persist; highlights re-appear (**including selections that span multiple
      elements**); marks reposition on scroll.
- [ ] (If themed) host `:root` tokens are picked up automatically, or `window.MarkupModeConfig`
      overrides apply; turn comment mode off → the host page behaves exactly as before (no interference).

## Automated scenarios + expected results

These are encoded in `tests/regression.js` (479 checks) — the table below is the human-readable
summary; the script is the source of truth. Run `node tests/regression.js`.

| Area | Action | Expected |
|---|---|---|
| Mount | Load page | `window.__mmLayer === true`; `.mm-dock` present; `--mm-accent` resolves; no console errors (a `favicon.ico` 404 is benign). |
| Text anchor | Start mode; select first chars of a word-spanning run; `mouseup` | popup open, kind `TEXT`; `.mm-popquote` shows the **whole** word(s) (word-snap). |
| New-note modal | (popup open for a fresh anchor) | `.mm-popmode` reads "New note"; buttons are **Discard** / **Save note**. |
| Save | Type + Save | one note in `localStorage`; `CSS.highlights.has('mm-note')` true; one `.mm-overlay .mm-pin`. |
| Element anchor | Click a `.card`; type + Save | second note, `anchors[0].kind === 'element'`; two marks; selector recorded. |
| Smart target | Click nested control / card heading | nested button resolves to `button`, not wrapper divs; card heading click resolves to the card/component boundary. |
| Markdown prose | Click paragraph/code block/link in generated Markdown preview | paragraph/code block become whole-block `TEXT` notes; link remains `ELEMENT`. |
| Reveal/select | **Single-click** a dock row or mark | the row gets `.mm-row-active`, its mark `.mm-pin-active`; the popup does **not** open; works with mode **off** and does not arm mode. |
| Mark salience (3-tier, bidirectional) | Hover, then click, dock rows with ≥2 notes | **Resting** marks stay clearly visible — strong borders (element) / full-accent underline (text) / pin opacity .8 — with only the *fill* pulled back, so an idle/minimized page still shows where every mark is, all at equal weight. **Hover** a row → its page mark + highlight lift (fuller fill, pin→1); hovering a mark lifts its row (bidirectional). **Click** pins it (persists; `mm-note-active` + ring/thicker underline). Pinning **clears on minimize** and a **new note auto-pins**. Subtle, not jarring. |
| Hide marks (Settings) | Settings → toggle **Show marks** off | hides pins, element boxes, **and text highlights** (`mm-note`/`mm-note-hover`/`mm-note-active` all unregistered — no leftover underline/fill); toggling back on restores them. There is **no header marks toggle** — it lives only in Settings. |
| Panel chrome | Open the dock | header reads **"Markup Mode"** at `--mm-fs-lg` with a small accent chip before it; collapsed pill stays compact ("Markup · N"). |
| Edit | **Double-click** a row/mark, or click `.mm-redit` (✎) | editor opens; `.mm-popmode` "Editing · Note N"; buttons **Cancel** / **Save**. |
| Cross-ref | While a note is open, **⌥ Alt + click** another element / **⌥-drag**-select a long text run | a `[ref: …]` token is inserted (text ref carries the **full** quote); **no** new note. Dashed reference target outline shows only while Alt is held; plain click/dblclick/selection inserts nothing. |
| Copy-ref | Enable copy-ref mode; click an element | clipboard receives `[ref: …]`; note count unchanged; no popup. |
| Delete/undo | Click a row's `.mm-rdel` (✕), then the toast's Undo | note removed, an **Undo** `.mm-toastbtn` toast appears; Undo restores the note with its id. |
| Compile | Compile | `.mm-compiled` matches the contract; **Source:** line is `host`+path (or full FS path under `file:`). |
| Export | Export | filename matches `^<base>-markedup-\d{8}-\d{6}\.md$`; for a generic `index.html`, `<base>` is the title slug. |
| Cross-node | Save a selection spanning a nested `<strong>`, reload | anchor persists `startOff`/`endOff`; `CSS.highlights.get('mm-note').size >= 1` (re-paints across nodes). |
| Rail (right) | Dock to right; read body | wide viewport: `body.style.marginRight` set; grip resize clamps at `280px` and `round(innerWidth*0.5)`; compact viewport: body margins clear and marks realign. |
| Rail (left) | Cycle to left rail; back to float | `marginLeft` set + `marginRight` cleared; float clears both. |
| Handle | Drag panel to center, collapse | the pill sits within ~24px of the bottom-right corner. It is the **minimized affordance only** — hidden whenever the panel is open (float or rail), visible only when minimized. |
| Config | `MarkupModeConfig` set before load | `ns` moves the storage key; `accent` sets `--mm-accent`; a custom `shortcut` toggles, the old one doesn't. |
| Theme/settings | Host `:root` exposes `--accent`; settings changed | host accent is auto-adopted unless `autoTheme:false`; Appearance supports auto/light/dark, reduce motion, accent swatches/picker, and contrast readout; Behavior persists show-marks/open-on-reveal; the **Customize** section leads with an agent-first callout ("more settings can be baked in") + an expandable "What you can change & how" listing keys/colors/fonts/behavior. |
| A11y | roles + roving nav | toast `role=status`/`aria-live`; popup `role=dialog`/`aria-modal="false"` with mode `aria-label`; `.mm-overlay` `aria-hidden`; list rows `role=listitem` with id-bearing ✎/✕ `aria-label`s; `↑/↓` moves row focus, `Enter` reveals; `Esc` restores focus to the trigger. |
| Mode off | Turn mode off | `document.body` loses `mm-armed`; per-interaction listeners detached. |

## Cross-host adaptation check (do this when changing the breadcrumb/theme logic)

Inject the block into a **different** artifact (e.g. one with `<nav>/<section>/<footer>` and an
external stylesheet) and confirm: theme variables resolve to the host's tokens when mapped; `Where`
breadcrumbs use the host's landmarks/headings; selectors resolve; everything in the table above
still passes. (Validated against a skills dashboard during development.)

**Unsupported hosts (client-rendered shells).** `apply.sh` refuses targets whose `<body>` is built
at load by JS — Databricks notebook exports, Next/Nuxt/Angular/React SPA exports, or a near-empty
`<div id="root">` + bundle page — exiting 3 with an explanation and the two workarounds (Save Page
As → "Webpage, Complete" then apply the snapshot; or the Markdown route). `--force` overrides. A
normal static document must NOT be flagged. (Automated as HOSTGUARD in `tests/regression.js`.)
