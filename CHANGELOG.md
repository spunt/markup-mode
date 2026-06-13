# Changelog

All notable changes to Markup Mode are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-12

First public release. A single, zero-dependency block of HTML/CSS/JS that turns any web page into a
reviewable surface and compiles location-anchored notes into tagged Markdown for a person or an AI
agent to act on. No backend, no build step, no dependencies; it never mutates the host's content.

### Added

- **Text and element anchoring.** Drag-select snaps to word boundaries and highlights in place via
  the CSS Custom Highlight API (no DOM mutation). Clicking an element runs through an intent resolver
  that prefers real controls, semantic boundaries, and prose blocks over anonymous wrappers, with
  `↑`/`↓` to grow or shrink along the target chain.
- **Compiled Markdown handback.** Every note compiles to a tagged block with a human breadcrumb, the
  exact quote, and a `Locator` (the edit span wrapped in `⟪ ⟫` with surrounding context) under an
  "act only on a unique match, else refuse" contract — a format tuned by an autoresearch loop
  (see [`docs/handback-validation.md`](docs/handback-validation.md)).
- **Notes travel with the file.** Notes persist in `localStorage`; **Export reviewed HTML** bakes
  them into the file so a shared copy rehydrates marks, dock, and highlights on open. **Export .md**
  produces the agent task-list handback.
- **One-command applier.** `scripts/apply.sh` splices the layer into any HTML target — or renders a
  `.md`/`.markdown` file (pandoc → `marked` → python fallback) and splices it — writing a
  markup-enabled copy without touching the original, finishing with a static self-check.
- **Host-suitability gate.** The applier refuses client-rendered app shells (SPA / notebook exports)
  by default and routes the user to a static snapshot or the Markdown path.
- **Theming and one config file.** Seven `--mm-*` variables with host `:root` auto-detection;
  `markup-mode.config.jsonc` (plus `scripts/config.sh`) sets accent, namespace, toggle shortcut,
  keymap, and behavior defaults, baked in at apply time. Precedence: CLI flag > config file > default.
- **Dock UX.** Right/left rail or floating dock; minimize-to-pill; drag and resize; sortable notes
  (created / document order / manual); a select-then-edit interaction model; undo-on-delete;
  hover-to-view tooltips; and an Appearance/Behavior settings panel.
- **Accessibility.** Focus-trapped dialog, ARIA-live toasts, a `role="list"` notes list with roving
  arrow-key navigation, and labeled icon buttons.
- **Quality gate.** Headless Playwright regression suite (`tests/regression.js`) plus cross-host
  adaptation checks.

[1.0.0]: https://github.com/spunt/markup-mode/releases/tag/v1.0.0
