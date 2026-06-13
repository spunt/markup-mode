# Markup Mode — architecture

Read this before modifying the layer. Everything lives in one IIFE inside the `<script>` of
`assets/templates/markup-mode.html`; styles are in the two `<style>` blocks (`mm-style` and
`mm-hl-style`). All classes/ids/state use the `mm-` prefix; the global guard is `window.__mmLayer`.
Runtime config is read once at the top of the IIFE from an optional `window.MarkupModeConfig`
(`CFG`); see `adaptation.md` §0. Run `node tests/regression.js` after any change.

## Design goals (why it's built this way)

1. **Non-invasive.** The host's DOM and content must be untouched and the block must be removable
   without trace. → text highlighting uses the **CSS Custom Highlight API** (ranges styled via
   `::highlight(mm-note)`) instead of wrapping text in spans; element outlines/marks live in a
   separate fixed **overlay layer**, not inside host elements.
2. **Unambiguous anchors.** Every note records a human breadcrumb + an exact quote (text) or a CSS
   selector (element). Marks/outlines make the on-screen target obvious.
3. **No backend.** State is `localStorage`; output is Markdown via clipboard/Blob download.
4. **Adapts to host.** Theme via CSS variables; breadcrumbs via generic landmarks/headings.

## Data model

```js
note = {
  id,                 // sequential, stable; also the mark label
  comment,            // the note text (may contain inline [ref: …] tokens)
  ts,
  anchors: [ primary ]    // array; currently length 1 (see "anchors" note below)
}
anchor = { kind:"text"|"element", selector, quote?, startOff?, endOff?, desc?, where, _range? }
```

- `selector` — a CSS path from `body` (`#id` shortcut where available, else `tag:nth-of-type(k)`).
- `quote` — for text anchors, the exact selected string (word-snapped).
- `startOff`/`endOff` — for text anchors, the selection's absolute character offsets within the
  `selector`'d common-ancestor element's text (`offsetInEl`). These persist as plain integers and are
  the **primary** re-resolution path on load (`rangeFromOffsets`), so a selection that spans multiple
  text nodes re-paints, and duplicate quotes resolve to the exact original occurrence. Legacy notes
  saved before this existed have no offsets and fall back to `quote`.
- `where` — the human breadcrumb (`sideOf › sectionOf › selfDesc`).
- `_range` — a live `Range` cached at runtime for text anchors; **stripped on persist** (a JSON
  replacer drops `_range`). On load `ensureRange()` rebuilds it via `rangeFromOffsets()` first, then
  falls back to `rangeFromQuote()` (first-match `TreeWalker`) for legacy notes.

**On `anchors` being an array:** the model keeps an array for forward-compatibility, but cross-
references are currently inlined into `comment` as `[ref: …]` tokens (a product decision — see
history), so in practice every note has exactly one anchor. The array + the compile loop's
`anchors.slice(1)` "Also refers to" branch are dormant scaffolding; leave or remove deliberately.

## Visual model

`vis: { [noteId]: [ {anchor, pin, box?, range?} ] }` — one visual entry per anchor.

- `pin` — a `.mm-pin` in the overlay; `dataset.id` links it back to the note; click → `openEditNote`.
- `box` — a `.mm-out` outline (element anchors only).
- `range` — a live `Range` (text anchors) collected by `refreshHighlights()` into one `Highlight`.

`repositionAll()` (rAF-throttled) recomputes every pin/box position from live geometry each frame it
runs, plus the hover candidate outline and the open note's primary outline. It is scheduled on
scroll (capture-phase, to catch inner scroll containers), resize, and after any mutation.

## Key subsystems

- **Config/theme/preferences** (`CFG`/`PREFS`/`applyConfigOverrides`/`applyHostSniff`): `CFG` is read once at the top of
  the IIFE. `NS`, `SRC_PATH`, and the keymap (`toggle`, `addRef`, resize, optional copy-ref chord)
  honor it. Per-namespace user preferences (`NS+":prefs"`) sit above built-ins and author config for
  interactive choices such as theme mode, accent, reduce motion, show marks, and open-on-reveal.
  `applyConfigTheme()` was split into two functions: `applyConfigOverrides()` applies any explicit
  `CFG` color keys; `applyHostSniff()` sniffs the host's `:root` for recognizable tokens (skipped if
  `CFG.autoTheme===false`). Both are called in `mount()`; `applyConfigOverrides()` is also re-called
  after the runtime settings UI changes palette/accent state, so config colors always win where the
  adopter explicitly set them.

  **Runtime Appearance settings:** explicit CSS class-scoped palettes —
  `.mm-theme-light { --mm-bg: …; … }` and `.mm-theme-dark { … }` — are toggled on
  `document.documentElement` (matched by the CSS as `:root.mm-theme-light`/`:root.mm-theme-dark`).
  Settings supports `auto`/`light`/`dark`, reduce motion, and accent picker/swatches with a contrast
  readout. `auto` clears the explicit palette class and lets `prefers-color-scheme` participate.
  Precedence (high → low): `MarkupModeConfig` color overrides (`applyConfigOverrides`) → persisted
  user accent/theme preferences → host-token sniff → `@media` defaults → `:root` light
  defaults. **`--mm-on-accent`** was introduced as a new token (dark text on the accent fill) so
  icon/label text on accent-colored buttons passes WCAG AA: light palette 5.10:1, dark 6.43:1 (was
  3.18/2.36 — both failures). This resolves the deferred color-contrast residual.
- **Comment mode** (`enterMode`/`exitMode`): toggles body `mm-armed`, attaches/detaches the
  per-interaction listeners (`mousemove`, `click`, `mouseup`, `keydown`, all capture-phase on
  `document`). Off by default → zero interference with the host. **Navigation (reveal/select) does
  NOT arm mode** — only creating or editing a note does.
- **Capture (`resolveIntentTarget`/`onUp`/`onClick`):** a non-collapsed selection on mouseup → text
  anchor (range cloned, `expandToWords()` snaps boundaries, `offsetInEl` records
  `startOff`/`endOff`). A click with no selection runs through `resolveIntentTarget()` before
  becoming an element anchor: candidates from the event path are scored so real controls,
  semantic/component boundaries, useful classes/attributes, and prose blocks beat anonymous wrapper
  `div`/`span` nodes. `↑/↓` in `onModeKey` walks the resolver's meaningful target chain rather than
  raw parent/first-child. In Markdown previews (`.doc`), clicks on prose blocks (`p`, `li`,
  headings, `blockquote`, `pre`) become whole-block **text** anchors; links/images/tables/controls
  remain element anchors. Each opens the popup, or — if a popup is already open and the add-ref
  modifier is held — inserts a `[ref:]` (`insertRef`), or — if Copy-ref is enabled — copies a ref
  (`copyReference`).
- **Popup** (`openPopupFor`/`saveCurrent`/`closePopup`): a focus-trapped `role="dialog"` that is
  deliberately **`aria-modal="false"`** — it is functionally non-modal (the reviewer keeps clicking the
  page *behind* it to attach `[ref:]` anchors while it stays open), so claiming modality would misrepresent
  it to assistive tech; the Tab focus-trap is kept anyway for keyboard usability. Sticky —
  closes only via Save/Cancel/Discard/Esc. Header + button labels are context-dependent: **New note**
  / Discard / Save-note for a fresh anchor, **Editing · Note N** / Cancel / Save for an existing note
  (`p.editId`). New-note draft persists per-anchor (`saveDraft`); edit mode is draft-free. Captures
  the trigger on open and restores focus to it on close. `overlay` gets `mm-editing` while open.
- **Highlights** (`refreshHighlights`/`rangeFromOffsets`/`rangeFromQuote`): rebuilds the single
  `Highlight` from all text ranges. `ensureRange` re-resolves a text range from `startOff`/`endOff`
  (offset walk, multi-node-safe) first, falling back to first-match `rangeFromQuote` for legacy notes.
- **Reveal + select** (`revealNote`/`setActive`): a *single* click on a mark or dock row calls
  `revealNote` — scrolls the anchor into view, flashes pin/box, scrolls/flashes the dock row, and
  marks the note **active** (`setActive`: `mm-row-active` + `mm-pin-active`, persistent until another
  is selected or `Esc`). It does NOT arm mode; minimized marks still reveal, and `PREFS.openOnReveal`
  decides whether reveal expands the dock. **Editing** is a separate gesture — double-click a
  mark/row, or the row's `✎` button — routed through `openEditNote` (which arms mode for `[ref:]`).
- **Notes-list keyboard nav**: the list is `role="list"`, rows `role="listitem"` with a roving
  `tabindex` and `aria-current` on the active row; `↑/↓` move focus, `Enter`/`Space` reveal. The
  `onModeKey` arrow-resize branch yields when focus is inside the dock so list nav and element resize
  don't fight.
- **Dock placement** (`applyDock` + handlers): float (draggable by header, resizable via CSS; the
  collapsed pill is `position:fixed` to the bottom-right corner so it never drifts), or rail
  (`mm-rail`) docked to the **right or left** edge (`dockState.side`, default right; left adds the
  `mm-rail-left` modifier). Rail reserves space via `body.marginRight`/`marginLeft = railW` and is
  width-resizable via a custom edge grip (`mm-railgrip`), clamped to `[280px, 50vw]` on wide
  viewports. Below the compact breakpoint, rails span the viewport and clear body margins so the
  overlay remains aligned with the host page. Direct header buttons move immediately to float, left,
  or right. Minimize schedules a follow-up `repositionAll()` after the body margin transition settles.
- **Settings panel** (`renderSettings`/`savePrefs`): a gear button opens an in-dock preferences view
  with tabs for Appearance and Behavior. Appearance writes theme mode, reduce motion, and accent
  preferences; Behavior currently writes `pinsVisible` and `openOnReveal`. Settings uses the same
  dock renderer/state path as the notes list, so changes apply live and persist per namespace.
- **Toast** (`toast(msg, action?)`): an `aria-live` status region. With an `action` (`{label, fn}`)
  it renders a clickable `mm-toastbtn` and stays ~6s — used by `deleteNote` for **Undo** (restores
  the removed note at its original index, id preserved). Only the most-recent delete is undoable.
- **Foot/compile toggle + dirty auto-update** (`compile`/`exportMd`/`renderDock`): the foot area
  contains a **Show Compiled / Hide Compiled** toggle; **Copy** is rendered only while the compiled
  textarea is shown (`.mm-compiled.mm-show`); **Export** is always present, disabled when
  `notes.length === 0`. Label and Copy visibility are managed in `renderDock()` or the toggle handler.

  While the compiled view is shown, every call to `saveCurrent`, `deleteNote`, its undo restore, and
  Clear-all regenerates `compiledEl.value = compile()` automatically — no user action needed. The
  textarea's `input` event sets `compiledDirty = true` (user has typed in the preview); while dirty,
  auto-regeneration is suppressed and a `notes changed · Refresh` link (`.mm-link` style) is shown
  inline. The Refresh link calls `compile()` and clears dirty. **Dirty is also reset to clean on:**
  Hide→Show (re-shows fresh output), Copy, and Export — ensuring the next auto-update cycle starts
  from a known state.

- **List↔preview splitter** (item 5): a thin drag grip (`.mm-compiledgrip`) is rendered on the top
  edge of `.mm-compiled`, visible only when shown. Dragging it reallocates height: compiled height is
  set explicitly on the element; the list above keeps `flex:1` and shrinks to fill the rest. The
  native `resize:vertical` on `.mm-compiled` was removed and replaced with this grip. Min sizes:
  compiled ~80px, list ~46px (existing `min-height`). The button row (Show/Hide, Copy, Export) is
  pinned above the compiled area in the foot and does not move during a drag. Compiled height is
  persisted in `dockState.compiledH` via `saveDock()` and applied on mount.

- **Output** (`compile`/`exportMd`): builds the Markdown contract; the `Source:` line uses the full
  path (`SRC_PATH`). Export respects manual edits in the compiled textarea (unless dirty was cleared),
  and names the file from the source/title. The temp download `<a>` carries the `mm-ui` class and is
  appended inside the dock (not `document.body`) so `isOurs()` short-circuits `onClick`, preventing
  Export from spawning a phantom note or copying a ref.

- **Compiled-export format — quote-first attribution** (`compile`/`fullText`/`quoteOf`): every note
  (text *and* element) emits a `Quote` field. For text notes, `Quote` is the exact selected string;
  ≤32-char `Before:`/`After:` context strings (`prefix`/`suffix`, captured at selection time via
  the W3C/Hypothesis `TextQuoteSelector` pattern) are emitted when present — legacy notes without them
  gracefully omit those lines. For element notes, `Quote` is the element's visible text,
  whitespace-collapsed and capped at ~200 chars (`fullText(el)` → `quoteOf(text)`). The compiled
  header carries a **trust-order + assumptions preamble**: locate each note by `Quote` first; `Selector
  (hint):` is labeled as a positional fallback that may drift if the artifact was regenerated; two
  assumptions are stated (the agent has the original artifact named in `Source:`; the `.md` is the
  deliverable, not any `.markup.html`). Internal shorthand labels: `CTX` (text note context block)
  and `ELQ` (element quote derivation).

- **Persistence model — localStorage-primary with embedded seed** (`load`/`serializeNotes`/`loadEmbedded`):
  notes live in `localStorage` keyed by namespace. On mount, `load()` checks localStorage first; if
  the key **is present** (including an empty array after Clear-all), localStorage wins and the embedded
  block is ignored. If the key **is absent**, `loadEmbedded()` reads from a
  `<script type="application/json" id="mm-notes">` block in the document if one exists — this is the
  seed path for freshly-opened shared files. **Export reviewed HTML** (`exportHtml()`): clones the
  document, strips `mount()`-appended runtime nodes (`.mm-overlay`, `.mm-dock`, `.mm-pop`, `.mm-toast`,
  `.mm-chip`), removes the `mm-armed` body class, clears rail body margins
  (`marginLeft`/`marginRight`), then serializes the current notes via `serializeNotes()` into an
  idempotent `#mm-notes` `<script>` block (replacing any pre-existing one). The resulting
  `<name>.reviewed.html` preserves the inline `MarkupModeConfig`/`sourcePath` (same NS+Source on
  reopen) and the active `mm-theme-*` class on `<html>` so dark/light reopens correctly. Uses the
  `mm-ui` temp-`<a>` pattern to avoid spawning a phantom note. **Security:** `serializeNotes()` escapes
  `<` → `<` in the JSON string before embedding, so a note containing `</script>` or `<!--` cannot
  terminate the raw-text `<script>` block (was a stored-XSS vector before the fix).

- **Popup width resize + persistence** (`.mm-popgrip`/`dockState.popW`/`positionPop`): `.mm-pop` has
  a thin right-edge drag grip (`.mm-popgrip`). Dragging it sets an explicit `width` on `.mm-pop`,
  clamped to `[300px (default), min(540px, 90vw)]`. The grip carries `aria-hidden="true"` and does not
  participate in the dialog's focus trap. The resized width is stored in `dockState.popW` (via
  `saveDock()`). On next open, `openPopupFor()` reads `dockState.popW`, clamps to [default, max], and
  applies it before calling `positionPop()`, which uses the live element width to ensure the popup
  still fits on-screen after widening.

- **Dock-header direct position buttons + minimize** (v7): the cycling "dock to edge" button was
  replaced with two always-visible INACTIVE position icons rendered directly in the dock header —
  float, dock-left, and dock-right. Clicking the icon for the current position is a no-op; clicking
  an inactive one calls `applyDock()` for that position immediately. The close "✕" was replaced with
  a **minimize glyph** (`aria-label="Minimize"`) that collapses the dock to the pill while preserving
  the chosen dock position. First-open default is now `dockState.side = "right"` (right rail);
  persisted `dockState.mode`, `side`, and `open` are loaded as-is (back-compat).

- **Display-ordinal / sort system** (`orderedNotes`/`ordinalOf` — v7+): the number a user sees in a
  dock row, edit-popup header, compiled `.md`, and page-mark accessibility label is a **display
  ordinal** — the mark's 1-based position in the current sort order — rather than the stable internal
  `id`. Visible on-page marks are intentionally unnumbered. `orderedNotes()` returns `notes`
  reordered by the active `dockState.sort` mode:

  - **Created** (default) — insertion order; ordinals match id sequence.
  - **Document order** — `compareDocumentPosition` on resolved anchor elements; bounding-rect
    `top` tie-break for same-parent nodes; unresolved anchors sort last.
  - **Manual** — `dockState.manualOrder` (an array of ids set by drag-reorder of dock rows).

  `ordinalOf(id)` looks up a note's 1-based index in `orderedNotes()`. Every ordered consumer —
  dock row number, page-mark accessible label, edit-popup header label, and `compile()` — calls
  `ordinalOf`. The internal `id` remains stable and is still the key for `vis`, `dataset`, undo,
  localStorage serialization, and the `#mm-notes` embedded block. Sort mode and manual order are
  persisted in `dockState` via `saveDock()`.

- **Read-mode hover tooltip** (v7+): when comment mode is OFF, hovering a `.mm-pin` renders a small
  `.mm-pintip` positioned near the activation cursor while avoiding the marked anchor rectangle when
  space allows. Content is the note's `comment`, set via `textContent` (no HTML injection). The
  tooltip is `position:fixed`, translucent, `pointer-events:none` (never intercepts clicks), and
  `aria-hidden="true"`. It is hidden on pointer leave and stripped from the Export reviewed HTML
  snapshot with the other runtime UI.

- **Alt/Option-gated references** (v8, Phase 2): while a note popup is open, inserting a `[ref:]`
  requires the **add-reference modifier** (default **Alt/Option**, resolved from `keymap.addRef.mod`).
  `onClick`'s `pending` branch inserts an element ref only when `addRefModHeld(e)` is true; `onUp`'s
  `pending` branch inserts a text ref only when the modifier was held at mouseup. The hover candidate
  outline is also modifier-gated while editing: `refModActive` is refreshed on mousemove/click/mouseup
  and on keydown/keyup so the dashed target box appears only while the add-reference modifier is held.
  A plain click, plain double-click, or plain selection while the popup is open is a no-op. This **replaces** the
  v7 double-click gating (`onDblClick` was deleted): the double-click collided with the browser's
  native double-click-to-select-a-word, so the word-select branch won and the ref often failed to
  insert. The modifier is unambiguous and configurable. Pin/dock-row double-click still routes to
  `openEditNote` (and is now inert while a note is open — matching the pin guard). Copy-ref mode is
  unaffected. Supersedes both the v7 double-click gate and the older "Shift-gate for inserts/refs"
  backlog item.

## Z-order (intentional)

```
host content  <  overlay (outlines/marks, 2147483640)  <  dock (2147483644)  <  popup (…646)  <  toast (…647)
```
The dock sits **above** the overlay so the panel is never hidden behind a mark/outline.

## Invariants to preserve when editing

- Never mutate host DOM for highlighting (keep the Custom Highlight API path; the span fallback, if
  any is added, must be opt-in and reversible).
- All listeners that fire during normal host use must be removed when comment mode is off (only the
  shortcut keydown + passive scroll/resize may remain).
- Persisted notes must round-trip without `_range` (keep the JSON replacer), but **must** keep
  `startOff`/`endOff` — they are the primary text re-resolution path; `rangeFromQuote` is only the
  legacy fallback.
- Single-click (reveal/select) must NOT arm comment mode; only create/edit (`openEditNote`) arms it.
  Keep the popup's focus trap + focus-restore intact, and the overlay `aria-hidden` (the notes list
  is the canonical assistive-tech/keyboard interface).
- Class/state names stay under the `mm-` prefix; don't reuse a state class as an element class. The
  dock's state classes `mm-rail`/`mm-rail-left` must stay distinct from button classes
  (`mm-railbtn`, `mm-redit`, `mm-rdel`) — the `mm-rail` vs `mm-railbtn` collision was a real bug.
