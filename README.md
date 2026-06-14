# Markup Mode

**Your agent builds something. It applies Markup Mode to its own output in one command, and you mark exactly what's off — the precise word or element, right on the page.**

*The layer captures the exact spot you marked and compiles it into Markdown you hand back to the agent. Frontend-only — no backend, no build step, and it never changes your document's own content.*

[![Markup Mode in action: arming the dock, highlighting a claim, writing a note, marking an element, and compiling to Markdown](docs/demo.gif)](https://www.bobspunt.com/markup-mode/assets/templates/markup-mode.html)

<sub>**[Try the live demo](https://www.bobspunt.com/markup-mode/assets/templates/markup-mode.html)** · one HTML file, opens in any browser</sub>

## Contents

- [Why I built this](#why-i-built-this)
- [Why you might want it](#why-you-might-want-it)
- [What you hand back](#what-you-hand-back)
- [Quick start](#quick-start)
  - [Use it as an agent skill](#use-it-as-an-agent-skill)
  - [Use it on a page by hand](#use-it-on-a-page-by-hand)
- [How it works](#how-it-works)
- [Customize it](#customize-it)
- [Good to know](#good-to-know)
- [License](#license)

## Why I built this

My agents build a lot of what I review — a generated report, a draft landing page — and the bottleneck was never *spotting* what's off. I could see it instantly ("this number needs a source," "that axis starts at 50, not zero"). The hard part was telling the agent *which* word or *which* element I meant. A screenshot hands it a picture, not text it can locate. "Fix the third chart" makes it guess. So I'd describe a spot in prose while the agent hunted for it — busywork an agent is supposed to spare you.

So Markup Mode takes that step off the table. The agent applies the layer to its own output in one command (`scripts/apply.sh`); you click the sentence or element that's wrong and type a note. The part that stays human is the review — *you* decide what's wrong and why. What's automated is the mechanical part: applying the layer, and compiling your notes into a handback file — the compiled Markdown — you pass back to the agent (or it reads the file itself).

Each note carries three things: a readable "Where" trail (like `Main › §"Results" › p "Conversion rose…"`), the exact quote, and a **locator** — that quote plus a little of the surrounding text. The locator matches on the words themselves, so it survives the markup-and-formatting differences between the rendered page and the source — though not the words being rewritten. When a quote repeats on the page, the surrounding context is what resolves it to one spot. The handback is formatted to tell the agent to edit only where a note points to a single spot, and to flag a note rather than guess when it doesn't. The agent's cooperation is still the agent's; what the tool controls is the instructions it gets.

No agent in the loop? You can add the layer by hand and review exactly the same way — turn it on, mark up, hand off the notes. The agent loop is what it's built for, but reviewing your own work is a first-class use too.

## Why you might want it

It's for people who run agents on real work and want a tighter pass on what comes back — feedback pinned to exact text or an element, handed over as Markdown.

A few ways it gets used:

- **Marking in place, so the agent edits the exact spot.** Your agent builds an artifact and applies the layer; you mark precisely what's wrong, right on the page; the compiled notes go back as a handback that points the agent at that exact spot.
- **Design and copy review without a tracker.** Drop the layer into a staging page, leave element and text notes, and hand the Markdown to whoever's iterating — no ticket, no tracker.
- **Your own QA pass.** Walk a page you built, pin issues as you spot them, and export a checklist before you ship.

## What you hand back

Compile turns every note into a Markdown block meant to be acted on. The quote comes first, so a human or a model can find the spot by its words even when the page's markup differs, and the selector is only a positional hint:

```markdown
# Feedback — Quarterly Report (review)
Source: reports/q2.html · 2 notes · 2026-06-04

## Note 1 · text
Where: Main › §"Results" › p "Conversion rose 18% in Q2…"
Quote: "rose 18%"
Selector (hint): main > section:nth-of-type(2) > p
Comment:
> Source for this figure? It contradicts the dashboard.

## Note 2 · element
Where: Main › §"Results" › div.chart
Selector (hint): main > section:nth-of-type(2) > .chart
Comment:
> Axis starts at 50, not 0, so it overstates the trend.
```

![The dock open in dark mode: two notes anchored to the page, with the compiled Markdown shown below](docs/compiled.png)

## Quick start

### Use it as an agent skill

Markup Mode is built to run as an agent skill: tell your agent *"mark up this page"* and it applies the review layer with one command (`scripts/apply.sh`), then compiles your notes into a tagged-Markdown handback you pass back to it. It works on rendered HTML and Markdown — for a `.md` file, the same command renders it first, then splices the layer in. It declines client-rendered SPA shells, since there's no server-rendered text to anchor to (see [Good to know](#good-to-know), or pass `--force`). It writes a markup-enabled *copy* and adds the layer to that copy, so it never changes your document's own content.

- **Any `SKILL.md`-aware agent (Claude Code, Codex, …).** Drop this repo into your agent's skills directory — e.g. `~/.claude/skills/markup-mode/` or `~/.agents/skills/markup-mode/` — so the agent reads `SKILL.md` at the root.
- **As a Claude Code plugin.**
  ```
  /plugin marketplace add spunt/markup-mode
  /plugin install markup-mode@markup-mode
  ```

### Use it on a page by hand

No agent? Open [`assets/templates/markup-mode.html`](assets/templates/markup-mode.html) — a runnable demo of the layer and the file you copy the block from. To add it to **your** page, copy everything between the two `<!-- MARKUP MODE - copy from here / to here -->` markers (both `<style>` blocks and the `<script>`) and paste it just before your `</body>`. Notes live in `localStorage` and go nowhere until you copy or export; delete the block and the layer is gone.

*(Optional)* Match your design: point the seven `--mm-*` variables at your own tokens, or let it auto-detect common host variables. See [`references/adaptation.md`](references/adaptation.md).

## How it works

- **Text anchors.** Drag-select a phrase. It snaps to word boundaries and highlights in place through the CSS Custom Highlight API, which paints over the text without touching the DOM, and it records the exact quote.
- **Element anchors.** Click to mark an element. Markup Mode now resolves the likely intended target instead of blindly using the browser's raw hit target, so nested controls, cards, and prose blocks behave more naturally. `↑`/`↓` grows or shrinks along that meaningful target chain, and a compact unnumbered mark plus an outline label it.
- **Adapts to the host.** It auto-detects common `:root` tokens like `--accent`, `--bg`, and `--text`, or you can set the colors, namespace, shortcut, and source path through `window.MarkupModeConfig`. Otherwise it falls back to sensible light and dark defaults.
- **A dock that stays out of the way.** It opens as a right-side rail by default, can minimize to a corner pill, and can also float or dock left. On wide screens rails reserve space instead of covering the page; on narrow screens they compact to the viewport so marks stay aligned with the page.
- **Markdown out.** The compiled bundle is shown as a read-only preview generated from the notes. Copy it, or download it as `<artifact>-markedup-<timestamp>.md`. You can also export a self-contained reviewed HTML file with the notes embedded.

Keyboard navigation works throughout, with a focus-trapped editor and ARIA-live status. The internals and the backlog are in [`references/`](references/).

## Customize it

You can tweak the look and keys for a single page right in the dock's gear panel (theme, accent, reduce motion). But the things you want to set *once and forget* — your accent color, a different toggle shortcut, the typeface, default behaviors — live in one place: **`markup-mode.config.jsonc`** at the repo root. Set them there and they bake into **every** markup file you generate from then on. It ships empty, so out of the box you get the same sensible defaults as everyone else.

It reads like this — set only the keys you care about:

```jsonc
{
  "accent": "#6366f1",
  "keymap": { "toggle": { "key": "m", "mod": true, "shift": true } },  // Cmd/Ctrl+Shift+M
  "behavior": { "themeMode": "dark" }
}
```

When you generate a marked-up file, anything you set here wins over the built-in default — and an explicit flag on the command (say `--accent "#0f766e"` for a one-off) wins over both. So the rule is simply: **command flag > config file > built-in default**.

Three ways to change it, whichever suits you:

1. **Edit the file by hand.** It's plain JSONC with comments and a `$schema` for editor autocomplete. Uncomment a key, set it, save.
2. **Run a command.** `scripts/config.sh set <key> <value>` validates the value and writes it for you, preserving your comments and other keys — e.g. `scripts/config.sh set accent "#6366f1"`. `scripts/config.sh list` shows every key and its current value; `scripts/config.sh help` lists them all.
3. **Just ask your agent.** Since Markup Mode is also a Claude Code skill, you can say *"set the markup-mode accent to #6366f1"* or *"rebind the markup-mode toggle to Ctrl+Shift+M"* and it'll run `config.sh` and update the config for you.

Full key list and the precedence details are in [`references/adaptation.md`](references/adaptation.md).

## Good to know

- **Browser support.** Text highlighting uses the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API) (Chrome/Edge 105+, Safari 17.2+, Firefox 140+). Where it's missing, notes still work and list their quotes, and only the in-place highlight is skipped. Everything else is vanilla DOM.
- **Privacy.** Everything runs in the browser. Notes sit in `localStorage`, keyed per page, and leave only when you copy or export.
- **Quality.** A headless Playwright suite (`tests/regression.js`) backs it — run `node tests/regression.js` for the live pass/fail tally — plus adaptation checks against real artifacts. The handback format itself was tuned by an autoresearch loop measuring how reliably an agent can act on the notes without mis-editing; that result is written up in [`docs/handback-validation.md`](docs/handback-validation.md). The untested and deferred items, like touch input, bottom-edge docking, and a full screen-reader audit, are tracked in [`references/open-items.md`](references/open-items.md).

## License

[MIT](LICENSE) © 2026 Bob Spunt. Use it in anything, including commercial work. Keep the copyright notice.
