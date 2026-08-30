# 0011. Per-domain status vocabularies and honest record links

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** UI-005

## Context

The concept system's `StatusBadge` mapped a single hard-coded set of
statuses (draft, planned, in progress, review, approved, locked, failed,
warning, archived) to badge colours, and `RecordLink` was a presentational
button with no real navigation and no notion of missing, deleted or
permission-restricted targets. Product records need status per domain
(experiments, reviews, samples and datasets each have their own states),
and relationships must link to real records while staying honest when a
target is gone or inaccessible.

Forces:

- Status must be communicated by text and icon shape as well as colour
  (DESIGN.md / WCAG): colour alone is never the only signal.
- One global state machine would force every record type into the same
  vocabulary, which is wrong for samples (quarantined, frozen) vs reviews
  (returned) vs datasets (retracted).
- Record links must be keyboard-operable real links, but auxiliary actions
  (open, unlink) must keep working and not navigate the row.

## Decision

1. **`src/components/scientific/` module.** `StatusBadge` and `RecordLink`
   live there, barrel-exported from `#/components/scientific`.

2. **Per-domain vocabularies.** `experimentStatusVocabulary`,
   `reviewStatusVocabulary`, `sampleStatusVocabulary` and
   `datasetStatusVocabulary` each map status keys to `{ label, tone, icon }`.
   `StatusBadge` takes either a built-in `domain` or a custom `vocabulary`.
   An unknown status falls back to a neutral pill with the raw text plus an
   `sr-only` "status: unknown" so the UI never silently hides a state.

3. **Text + icon + colour, never colour alone.** Every status definition
   carries its own Lucide icon (shape) and a visible label (text), mapped to
   a badge tone (colour). An `sr-only` tone hint is also emitted for screen
   readers. `data-status` is set for a11y audits and selectors.

4. **RecordLink is a real link that degrades honestly.** When `state` is
   `available` and `to` is provided, it renders a router `Link` (focusable,
   keyboard-operable, `aria-label="\${type}: \${title}"`). `missing`,
   `deleted` (line-through) and `permission-restricted` render as
   non-interactive rows with an explanatory label and state-specific icon —
   never as dead links. Auxiliary `actions` are preserved in a stop-
   propagation wrapper so they do not navigate the row.

5. **PropertyList stays explicit.** The UI-004 `PropertyList`/`Property`
   already take explicit inputs (label + children); a `StatusBadge` is a
   valid `Property` value, demonstrated on `/foundations`.

6. **No compact/comfortable variants unless justified.** `StatusBadge`
   supports `size: 'sm' | 'md'`; `RecordLink` is a single density. No
   further variants are added until two real consumers need them.

## Consequences

- `/foundations` now uses `StatusBadge` for the experiment and review
  statuses in the record preview, so reviewers see the productionised
  component, not a hand-rolled span.
- Later record routes pass `domain` + `status` from typed data; unknown
  statuses surface immediately rather than rendering blank.
- `RecordLink` replaces the UI-004 `LinkedRecordList` row when a route
  needs real navigation or honest missing/deleted/permission states.
