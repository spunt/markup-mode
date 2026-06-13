# Handback-format validation

The compiled-Markdown contract that Markup Mode hands to an agent (the `Locator` +
"act only on a unique match, else refuse" rule documented in `SKILL.md` → *Compiled Markdown
contract*) is not a guess — it's the output of an autoresearch optimization loop that measured how
reliably a downstream agent could act on the handoff without mis-editing.

The loop pits candidate handoff formats against a frozen set of fixtures and scores three things:

- **Refusal-rate** (the lever — lower is better): how often the agent gives up on a note it *should*
  have been able to resolve.
- **Miswire-rate** (the guardrail — must stay 0): how often the agent edits the *wrong* location
  (e.g. the wrong one of several identical sibling lines).
- **Hit-rate** (no-regression): notes resolved and acted on correctly.

A held-out validation set guards against overfitting: a gain only counts if it generalizes to
fixtures the optimizer never saw.

## Result

The accepted change — replacing a split `Before:`/`After:` context pair with a single contiguous
`Locator` (the exact edit span wrapped in `⟪ ⟫`) plus an explicit uniqueness gate — moved the
HARD-stratum numbers decisively and held the guardrail:

- **HARD NET:** baseline 0.417 → **0.958** (↑ improved)
- **Refusal-rate** (the lever): **0.042** (baseline behaviour ≈ 0.6)
- **Miswire-rate** (the guardrail): **0.000** — held at 0
- **EASY hit-rate** (no-regression): **1.000**
- **Generalization (held-out val):** train 1.000 vs val 1.000 (gap 0.000); val miswire 0.000 — the
  gain generalizes, it isn't memorized

## Trajectory

Five iterations; one accepted (iter 1). Later candidates couldn't beat the accepted champion at the
required confidence (paired Δ-CI lower bound > 0.1):

| iter | decision | champ NET | cand NET | reason |
|---|---|---|---|---|
| 1 | accept | 0.417 | 0.958 | paired Δ-CI [0.42,0.69] > 0.1; rank 94%; miswire 0.00 ≤ 0.00 |
| 2 | reject | 1.000 | 1.000 | paired Δ-CI [0.00,0.00] (need lo>0.1), rank 0% |
| 3 | reject | 0.958 | 1.000 | paired Δ-CI [0.00,0.12] (need lo>0.1), rank 6% |
| 4 | reject | 0.917 | 1.000 | paired Δ-CI [0.00,0.23] (need lo>0.1), rank 12% |
| 5 | reject | 1.000 | 1.000 | paired Δ-CI [0.00,0.00] (need lo>0.1), rank 0% |

## The accepted change

**Rationale:** replace split `Before`/`After` with one contiguous `Locator` (quote sentinel-wrapped)
plus an explicit "act iff the Locator matches exactly once, else refuse" rule.

**Hypothesis:** hard refusal-rate ↓ (and hit-rate ↑) with miswire held at 0 — because the agent can
resolve repeated siblings via a single unique substring search instead of mentally combining two
separate context fields, and the uniqueness gate makes acting safe by construction.

```diff
--- seed/render_handoff.py
+++ accepted/render_handoff.py
@@ -34,8 +34,16 @@
 _HEADER = (
     "# Feedback — {title} (review)\n"
     "Source: {source} · {n} notes · {d}\n"
-    "How to apply: match each note by its Quote (exact text) first; Before/After are the "
-    "surrounding context for disambiguating repeats. The Selector is a positional hint only.\n\n"
+    "How to apply each note — deterministic, safe procedure:\n"
+    "1. Take the note's Locator: a verbatim slice of the document with the exact span to edit "
+    "wrapped in ⟪ ⟫ markers. The Quote field repeats that span on its own.\n"
+    "2. Strip the ⟪ ⟫ markers and search the document for the resulting contiguous string.\n"
+    "3. If it occurs EXACTLY ONCE, that occurrence is the target — act on it (edit only the part "
+    "that was inside ⟪ ⟫). The surrounding context in the Locator is what disambiguates repeated "
+    "lines, so a unique Locator match is safe to act on even when the Quote alone repeats.\n"
+    "4. If the Locator string occurs zero times or more than once, do NOT guess — refuse that note.\n"
+    "The Selector is a stale positional hint and may be WRONG; never use it to choose between "
+    "repeated lines.\n\n"
 )
```

The resulting render logic and prompt are what ship today in `SKILL.md`'s compiled-Markdown contract.
