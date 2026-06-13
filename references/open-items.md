# Open items — known limitations & backlog

Status legend: 🔴 known limitation (shipped as-is) · 🟡 nice-to-have · 🟢 decision recorded · 🧊 deferred indefinitely (documented, no planned milestone).

## To Do (🟢) [Update this doc to reflect the outcome of attempts to complete these]

- ✅ **Add MIT License** — done. `LICENSE` (MIT, © 2026 Bob Spunt) added; README license section resolved.
- ✅ **Source file reference should be full path** — done. `compile()` now emits the full path via a new `SRC_PATH` var (`file:` → `location.pathname`, else `host`+`pathname`); `SRC` (NS + export filename) left unchanged.
- ✅ **Existing-note interaction redesign** — done (Bucket C). Moved to a symmetric "select-then-edit" model so navigating no longer fires the editor. **Single-click** (dock row or mark) now *reveals + selects* only — it scrolls/flashes the anchor and persistently highlights the active row (`.mm-row-active`) and mark (`.mm-pin-active`); it does **not** arm comment mode or open the modal. **Double-click** (row or mark), or the new **✎ edit button** on the row, opens the editor. The modal is now context-dependent: a header label shows `Editing · Note N` vs `New note`, and the buttons read **Cancel / Save** when editing vs **Discard / Save note** for a new note — killing the fear that "Discard" deletes the whole note. Esc with no popup open clears the active selection (and exits comment mode). Row delete (✕) now shows an **Undo toast** instead of a silent permanent delete (most-recent delete only; id preserved on restore).
- ✅ **Handle position (minimized state)** — done (Bucket D). The collapsed pill (`.mm-handle`) is now `position:fixed; right:18px; bottom:18px;`, so it is viewport-anchored and ignores the dock's dragged `left/top`. The pill is corner-pinned to the bottom-right regardless of where the panel was dragged or whether it was previously railed; the panel itself stays draggable/resizable with its dragged position persisted.
- ✅ **Config object** — done (Bucket E). Adopters set `window.MarkupModeConfig` in a `<script>` before the block; supported keys: `ns`, `sourcePath`, `shortcut` ({key,mod,shift,alt}; `mod`=Cmd/Ctrl), and theme overrides `accent`/`accentSoft`/`bg`/`bg2`/`text`/`dim`/`border`. Absent config ⇒ identical to prior behavior. Limitation: the displayed shortcut hint stays static (`⌘⇧K`) even under a custom `shortcut`.
- ✅ **Re-resolve cross-node highlights** — done (Bucket F). Text anchors now persist absolute character offsets (`startOff`/`endOff`) of the selection within its common-ancestor element; `ensureRange()` rebuilds the range from those offsets (`rangeFromOffsets`/`posFromOffset`/`offsetInEl`) and falls back to quote search only for legacy notes.
- ✅ **Investigate truncation of cross-referenced text** — done. `refToken()`'s text branch now emits the full quote (whitespace collapsed, no length cap) instead of `squish(quote,60)`; element branch and `squish()` itself unchanged.
- ✅ **Optional left rail docking** (mirror of right rail) — done (Bucket D). The rail button now cycles float → right → left → float; the left variant positions the dock at `left:0`, reserves `body.marginLeft`, puts the resize grip on the panel's right edge (`.mm-dock.mm-rail.mm-rail-left`), and mirrors the resize math. `dockState.side` ("right"|"left", default "right", back-compat for legacy state) persists via `saveDock()`. **Bottom rail is DEFERRED** — the panel is a tall flex column (list `flex:1`), so a bottom strip needs a different layout and is not low-effort. Moved to Backlog.
- ✅ **Accessibility** — done (focused pass, Bucket G). The popup is now a `role="dialog"` with `aria-modal="false"` and an `aria-label` tracking the mode ("New note" / "Editing · Note N"), a Tab/Shift+Tab focus trap over its controls, and focus restore to the triggering row/mark on close. It is intentionally non-modal because the reviewer may keep clicking the page behind it to add `[ref:]` anchors. The toast is an `aria-live="polite"` `role="status"` region (Undo button gets an `aria-label`). The dock panel is a `role="region"` ("Markup"); the handle pill is a keyboard-operable `role="button"` (tabindex 0, Enter/Space toggles, `aria-expanded` reflects open state). The notes list is `role="list"` with `role="listitem"` rows that carry a summary `aria-label`, `aria-current` on the active row, and roving tabindex (one tabbable row); ArrowUp/ArrowDown move row focus and Enter/Space reveal+select (single-click semantics — does **not** open the editor). The global element-resize ArrowUp/Down handler early-returns when focus is inside the dock so list nav and element-resize never fight. Icon-only buttons (row ✎/✕, rail, close) got `aria-label`s; the decorative mark/outline overlay is `aria-hidden="true"` (the list is the canonical AT/keyboard interface).
- ✅ **Theme auto-detection** — done (Bucket E). `applyConfigTheme()` (called first in `mount()`) conservatively sniffs the host's `:root` for a small ordered candidate list per `--mm-*` token and adopts only the first one actually present (never guesses; `--mm-accent-soft` is never sniffed). Explicit `MarkupModeConfig` theme overrides win and suppress sniffing for that token; opt out entirely with `autoTheme:false`. With no recognizable host tokens and no config, the built-in defaults stand.

## Known limitations (🔴)

- ✅ RESOLVED (offset serialization, Bucket F): **Cross-element highlights don't re-paint after reload.** A text selection spanning multiple
  elements highlights fine in-session, but on reload `rangeFromQuote()` only re-locates quotes that
  live within a single text node (first match). The note and its quote always persist and remain in
  the list; only the in-place highlight is skipped. Single-node selections (the common case)
  re-paint correctly. New notes now persist `startOff`/`endOff` and rebuild the range across nodes;
  pre-Bucket-F (legacy) notes without offsets still use the single-node quote fallback.
- ✅ RESOLVED (offset serialization, Bucket F): **Quote disambiguation picks the first match.** If the exact selected string appears more than
  once inside the anchor's container, re-resolution (and the selector) point at the first
  occurrence. Rare for real review prose; could store a character offset to disambiguate. New notes
  now resolve by absolute offset so the correct occurrence is hit; pre-Bucket-F (legacy) notes
  without offsets still fall back to first-match quote search.
- **Client-rendered app shells are unsupported (now detected).** Markup Mode splices its layer into
  the page's HTML and anchors notes to the DOM present at load. A page whose `<body>` is built at
  runtime by a JavaScript bundle — **Databricks notebook exports** (`__DATABRICKS_NOTEBOOK_MODEL` +
  `notebook-main.js`), Next.js/Nuxt/Angular/React SPA exports, or any near-empty `<div id="root">` +
  bundle shell — replaces its own body after load, discarding the injected layer (it mounts to zero
  nodes, silently). As of this revision `scripts/apply.sh` **detects the common cases and refuses by
  default** with an explanation + the two workarounds (Save Page As → "Webpage, Complete" then apply
  to the static snapshot; or export to Markdown and use the `.md` route); `--force` overrides.
  Detection is conservative (signature match on known frameworks, plus a generic "external bundle +
  near-empty body" heuristic) — false negatives just fall back to the old behavior. Covered by the
  HOSTGUARD checks in `tests/regression.js`.
- **Selector stability on re-rendered DOM.** Selectors are `nth-of-type` paths. If the host
  re-renders with different sibling ordering between authoring and acting on the note, the selector
  can drift. Fine for static artifacts and within a review session; weaker for highly dynamic SPAs.
- **Touch interaction untested.** Interaction is mouse/keyboard oriented (drag-select, hover outline,
  `↑/↓`). Compact rail layout is covered, but no tap-and-hold or touch selection affordances exist yet.
- **Breadcrumbs need real headings.** The "Where" label leans on `<h1>–<h6>`/landmarks. Pages that
  use styled `<div>`s as pseudo-headings get a coarser breadcrumb (the selector/quote are
  unaffected). See `references/adaptation.md` §2.
- ✅ RESOLVED (focused pass, Bucket G): **No accessibility pass.** The dock/popup/marks now carry
  ARIA roles and labels and are keyboard-operable: dialog + focus-trap + focus-restore on the popup,
  an aria-live toast, `role="list"`/`listitem` rows with roving arrow-key navigation and Enter-to-reveal,
  icon-button labels, and a decorative (`aria-hidden`) overlay. **Residual / out of scope** for this
  pass: a full screen-reader audit (NVDA/VoiceOver pass on real prose). Color contrast and reduced
  motion now have first-class settings coverage.
- ✅ RESOLVED (item 6, 2026-06-02): **Color-contrast verification residual.** The runtime light/dark
  theme toggle (item 6) introduced explicit class-scoped palettes (`.mm-theme-light`/`.mm-theme-dark`)
  and a new `--mm-on-accent` token (dark text on accent fill). Measured contrast ratios: light
  5.10:1 / dark 6.43:1 — both pass WCAG AA (was 3.18/2.36, both failures). All other palette tokens
  verified passing under both palettes. A full screen-reader audit remains out of scope.
  
## Notes on shipped items (2026-06-02 revision)

- **Inline-SVG icon set** (item 7): all interactive glyphs replaced with inline SVG (`currentColor`,
  ~16px, `aria-hidden` on decorative instances). Sources: better-icons / Lucide / Feather (MIT,
  design-time only — zero runtime dep). Targets replaced: close, rail 3-state, compile chevrons, copy,
  export, copy-ref, mode circle/square, row edit/delete, rail resize grip. Text labels retained for:
  show/hide marks, Clear all, Start Markup Mode. All icon-only buttons keep `aria-label`s. Icons are
  theme-correct under both light and dark palettes via `currentColor`.

## Notes on shipped items (2026-06-03 revision)

- **Quote on every note + Before/After context:** `compile()` now emits a `Quote` on every note,
  including element notes (visible text, whitespace-collapsed, capped ~200 chars via `fullText`/`quoteOf`).
  Text notes add ≤32-char `Before:`/`After:` context (`prefix`/`suffix` captured at selection time —
  the W3C/Hypothesis `TextQuoteSelector` pattern; fuzzy matching delegated to the receiving LLM). The
  compiled header gained a **trust-order + assumptions preamble**: locate by `Quote` first; `Selector
  (hint):` is labeled as a positional fallback that can drift after regeneration. Legacy notes without
  `prefix`/`suffix` degrade gracefully (omit `Before`/`After`).
- **Notes travel with the file — embedded `#mm-notes` + Export reviewed HTML:** `load()` seeds from a
  `<script type="application/json" id="mm-notes">` block when localStorage has no notes for the
  namespace; **localStorage wins when its key is present** (even an empty array after Clear-all — no
  re-seed). New `serializeNotes()`/`loadEmbedded()`. New **"Export reviewed HTML"** dock action
  (`exportHtml()`) downloads `<name>.reviewed.html` with notes baked into an idempotent `#mm-notes`
  block; the snapshot is cleaned (overlay/dock/pop/toast/chip stripped, `mm-armed` removed, rail
  margins cleared) before serialize; preserves `MarkupModeConfig`/`sourcePath` and the `mm-theme-*`
  class. Closes the gap where a shared `*.markup.html` opened blank.
- **CRITICAL security fix — `<` escape in baked JSON:** the embedded `#mm-notes` JSON now escapes
  `<` → `<`. Before the fix a note containing `</script>` or `<!--` terminated the raw-text
  `<script>` block, corrupting the export and enabling **stored XSS** (arbitrary JS ran on reopen).
  Covered by hostile-payload round-trip checks in the regression suite.
- **Resizable comment popup:** `.mm-pop` is width-resizable via a right-edge drag grip (`.mm-popgrip`,
  `aria-hidden`; dialog focus trap unaffected). `min-width` = prior default (300px); `max-width:
  min(540px, 90vw)`. Width persists in `dockState.popW`; `positionPop()` reads live width so a wide
  popup still clamps on-screen.

## Notes on shipped items (2026-06-03 batch)

- **Direct dock-header position buttons + minimize + default-right:** the cycling rail button was
  replaced with two always-visible INACTIVE position icons in the dock header (float / dock-left /
  dock-right). Close "✕" became a minimize glyph (`aria-label="Minimize"`). First-open default is
  **right rail**; persisted `dockState` is honored (back-compat).
- **Hover-to-view tooltip on marks:** hovering a mark's compact page affordance (comment mode OFF)
  shows a theme-aware floating tooltip containing the note text only. Placement starts near the
  cursor, avoids the marked rectangle when space allows, and uses a translucent background with a
  light blur. `pointer-events:none`; comment set via `textContent`; stripped from the Export reviewed
  HTML clean snapshot.
- **Alt/Option to add a reference (v8, Phase 2 — replaces the v7 double-click):** while a note popup
  is open, inserting a `[ref:]` requires the add-reference modifier (default **⌥ Alt/Option**, from
  `keymap.addRef.mod`). A plain click/double-click/selection while the popup is open is a no-op. This
  fixes the reported bug where the v7 double-click collided with the browser's native word-select.
  `onDblClick` was deleted; the gate now lives in `onClick`/`onUp` via `addRefModHeld`. Supersedes
  both the v7 double-click gate and the older "Shift-gate for inserts/refs" backlog item.
- **Sort marks (created / document / manual) with renumbering:** a display ordinal is decoupled
  from the stable internal `id`. Dock rows, edit-popup labels, and compiled `.md` headings reflect
  position in the active sort order (`orderedNotes`/`ordinalOf`); on-page marks are intentionally
  unnumbered, with accessible labels that still track the current ordinal. Three modes: Created
  (default), Document order (`compareDocumentPosition` + bounding-rect tie-break), Manual
  (drag-reorder). Persisted in `dockState.sort` + `dockState.manualOrder`. Manual sort / drag-reorder
  shipped here.
- **"Markup" terminology:** marks are "marks" (was "pins"); dock/pill title is "Markup" (was "Review
  notes"); toggle is "Show marks"/"Hide marks". Note content stays "note". Internal `.mm-pin`
  identifiers and compiled `.md` tokens unchanged.
- **Ordinal-coherence fix (final-review catch):** edit-popup headers and on-page mark accessible
  labels were routed through `ordinalOf` so displayed/announced note order is consistent while the
  visible page mark itself stays unnumbered.
- **Suite growth:** this batch added ~90 checks (+92); later source hardening, settings/responsive coverage, smart-targeting coverage, Alt-gated reference outline coverage, scroll-stability coverage, the read-only compiled preview, tooltip collision coverage, dock-position persistence, and cursor-near translucent tooltips have expanded it further. The suite prints its own pass/fail tally on every run — don't commit a fixed count to docs (it stales immediately).

## Backlog (🟡)

- ✅ **Shift-gate for inserts/refs** — RESOLVED. Now implemented as the **Alt/Option-gated**
  add-reference modifier (v8, Phase 2). While the popup is open, a `[ref:]` is inserted only when the
  add-reference modifier (default ⌥ Alt, `keymap.addRef.mod`) is held; a plain click/selection is a
  no-op. (This replaced the interim v7 double-click gate, which collided with native word-select.)
- **Copy-ref affordances** — a one-shot "copy ref" (auto-exit after one) in addition to the toggle.
- **Import** — re-hydrate a notes set from a previously exported `.md` (round-trip). Note: the new embedded-`#mm-notes` round-trip (Export reviewed HTML) partially addresses persistence/sharing for the HTML format, but `.md` import is a distinct capability and remains open.
- **`compile()` does not escape Markdown control characters in note content** (pre-existing, not
  introduced in v6). `Quote`/`Before`/`After`/comment text is emitted raw, so a `"` or Markdown
  metacharacter in note content can yield slightly malformed Markdown. Low-impact — the receiving agent
  reads it as prose — but more visible now that every note emits a `Quote` and element quotes can be
  ~200 chars of arbitrary page text.
- **Expand to other artifact types.** Markdown is now supported (render → `assets/templates/markdown-host.html` → `scripts/apply.sh`). Next targets, each needing a host template + an anchoring strategy: **plain text** (wrap in a `<pre>`/prose host — trivial, basically markdown-host minus rendering); **PDF** (render pages to HTML/canvas, then anchor — non-trivial: text-layer vs raster); **images** (marks/boxes over an `<img>`, no text anchors — element-anchor model already fits). Sequence by effort: plain text → images → PDF.

## Deferred indefinitely (🧊)

Consciously parked — kept documented, but not planned for any current milestone. Revisit only if a concrete need arises (a mobile reviewer, a small-width-monitor user, or a formal accessibility-compliance requirement). These are decisions, not forgotten backlog.

- **Touch / mobile support** — interaction is mouse/keyboard-oriented (drag-select, hover outline, `↑/↓`, drag handles); no tap-and-hold / touch-selection affordances, untested on touch devices (also noted under Known limitations). Reviewers to date are desktop. Revisit if a mobile use case lands.
- **Bottom-rail docking** — a bottom-edge dock strip for small-width monitors. Non-trivial: the panel is a tall flex column (list `flex:1`), so a horizontal bottom strip needs a different internal layout than the right/left rails reuse. The right + left rails cover the common cases.
- **Full screen-reader audit** — a focused ARIA/keyboard pass already shipped (Bucket G: `role="dialog"` + focus-trap + focus-restore, aria-live toast, `role="list"` rows + roving arrow nav + Enter-reveal, icon `aria-label`s, `aria-hidden` overlay), and reduced-motion handling is now exposed in settings. Still out of scope: a real NVDA/VoiceOver pass on live prose. Revisit if a formal a11y-compliance requirement arises.

## Decisions recorded (🟢)

- **Frontend-only, copy/paste.** No backend, by design — distinguishes this from a heavier,
  server-backed feedback pipeline (SQLite + endpoints + triage). Output is Markdown.
- **Cross-references are inlined into the note text** as `[ref: …]` tokens (plus a Copy-ref mode),
  rather than tracked as structured secondary anchors. Chosen because the reference is most useful
  woven into the reviewer's prose and travels with the comment to the agent. The structured-anchor
  scaffolding remains dormant in the code (see `architecture.md`).
- **Element scope = positioned outline + mark**, not an SVG canvas. Lighter and equally unambiguous.
- **Rail reserves a column** (`body.marginRight`, or `marginLeft` for the left rail) rather than
  overlaying the page, so it is true side-by-side on wide screens. Width clamps to `[280px, 50vw]`
  there; on compact viewports the rail spans the viewport and clears body margins so overlay marks
  remain aligned.
- **Text highlight via CSS Custom Highlight API** (no DOM mutation) to keep the layer non-invasive.
- **Tiered verification (perf).** Applying the layer defaults to a **static self-check** (one round); a headless browser check is opt-in — auto-escalated only when the layer source or theme was customized, or forced via NL ("verify in a browser") / `apply.sh --verify full`. Rationale: the regression suite already proves layer *behavior*; per-application risk (injection, theme clash) is statically checkable. Rationale: in practice the browser verification dominated the per-application cost while the regression suite already covered the behavior. Nothing was removed — the thorough path is off-by-default, not gone.
- **One-shot applier** `scripts/apply.sh` is the default apply path; manual copy-paste retained as a documented fallback. The script is a **dev-time helper** — it does not change the layer's copy-paste / no-backend runtime ethos.
- **Output to CWD + original `sourcePath`.** The markup-enabled copy defaults to `./<base>.markup.html`; the applier records the **original** artifact's path in `MarkupModeConfig.sourcePath` so a compiled export's `Source:` line points at the original, not the copy being viewed.

## Validation status

A headless Playwright regression suite — `tests/regression.js` — runs against the
demo (`node tests/regression.js`), plus cross-host adaptation checks on real artifacts: a two-column
explainer with independently-scrolling panes, and a data dashboard with external
CSS/JS and `<nav>`/`<section>`/`<footer>` landmarks.

Covered: mount, text+element anchoring, word-snap, draft persistence, reload re-hydration (incl.
**cross-node** highlight re-paint via offset serialization), full-path Source line, untruncated text
`[ref:]`, Copy-ref (incl. pointer chip / no corner toast), compile/copy/export (incl. title-slug
filename, no phantom note in comment or copy-ref mode); the **select-then-edit** model (single-click
reveal/select vs double-click/✎ edit, context modal labels, undo-toast delete, reveal-with-mode-off);
active-note state; `window.MarkupModeConfig` (ns/accent/shortcut) + theme auto-detect and opt-out;
**Show/Hide Compiled** toggle + Copy gated to shown state; **dirty auto-update + Refresh link**;
**splitter height persistence**; **settings Appearance/Behavior** (theme auto/light/dark, reduce
motion, accent swatches/picker, contrast readout, show marks, open-on-reveal); icon `aria-label`s;
dock float / right-rail / left-rail margins + compact-viewport clearing + grip clamps + corner-pinned
pill + settled reposition after minimize; accessibility (dialog + aria-modal=false,
aria-live toast, list roles + roving arrow nav + Enter-reveal, focus restore, aria-hidden overlay);
z-order; **quote-on-every-note** (text notes: `Quote`/`Before`/`After`; element notes: visible-text
`Quote` derived via `fullText`/`quoteOf`); **trust-order + assumptions preamble** in compiled header;
**embedded `#mm-notes` seed on mount** (localStorage wins; baked block used only as fallback) +
**Export reviewed HTML round-trip** (clean snapshot, idempotent block, hostile-payload `<` escape);
**resizable popup width persistence** (`dockState.popW`, clamp to [default, max], on-screen clamp in
`positionPop()`); **dock position icons + minimize glyph + default-right + back-compat** (persisted
`dockState` position plus open/minimized state honored); **read-mode hover tooltip** on marks
(comment-mode-off guard, cursor-near placement, overlap avoidance, translucent background,
`pointer-events:none`, stripped from export snapshot); **Alt/Option ref gating** (plain click/double-click/selection while
popup open is a no-op; Alt+click / Alt-drag inserts `[ref:]`; dashed candidate outline appears only
while Alt/Option is held); **sort created/document/manual + renumbering + ordinal
coherence** (`orderedNotes`/`ordinalOf` consumed by dock rows, popup header, compile, and page-mark
accessible labels; visible page marks remain unnumbered; `dockState.sort`/`manualOrder` persisted;
`compareDocumentPosition` + rect tie-break for document
order; drag-reorder for manual); **smart element targeting** (nested control vs wrapper, component
boundary preference, Markdown paragraph/code whole-block text anchors, Markdown link stays element);

**Whole-region activation note:** making the entire marked element intercept normal clicks was
considered and deferred because it can break the reviewed artifact's own links, controls, and forms.
The safer current behavior keeps click/double-click on the compact mark affordance while using
non-intercepting outlines and cursor-near tooltips for discoverability.
**"Markup" vocabulary** (dock title, pill, show/hide toggle). See
`test_cases.md`.
Not covered by automation: subjective visual/UX judgment, touch interactions, and a full
screen-reader audit.
