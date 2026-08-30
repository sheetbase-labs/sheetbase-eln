# 0010. Record header and contextual inspector as reusable, stateless components

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** UI-004

## Context

The Experiment Notebook and Project Dashboard mockups both show a compact
record header (type · status · identifier · title · owner · updated ·
contributors · tags · actions) and a right-hand contextual inspector with
tabs (Properties, Members/Links, Files, Checks, Activity, Comments). Every
field is optional because a Project, Experiment, Protocol and Dataset each
expose a different subset. The inspector must stay usable when a record is
loading, unselected, unavailable or permission-restricted, and its content
must scroll independently of its identity header and close control.

Forces:

- UI-005 will harden `StatusBadge`, `PropertyList` and `RecordLink`, and
  UI-007 will harden `AuditTrail` and `ApprovalStepper`. UI-004 must not
  rebuild those building blocks; it must lay down section contracts those
  tickets improve rather than replace.
- The inspector must not own record selection. Selection lives in the URL
  so deep links and browser navigation work; the component must be drivable
  from route search params without fighting internal state.
- Long identifiers, long units, many tags and user-provided/translated text
  must not break the layout at narrow inspector widths.

## Decision

1. **`src/components/record/` module.** `RecordHeader`, `Inspector` and a
   set of section primitives (`InspectorSection`, `PropertyList`/`Property`,
   `LinkedRecordList`, `FileList`, `CheckList`, `ActivityFeed`,
   `CommentList`, `EmptyHint`) live there, barrel-exported from
   `#/components/record`.

2. **RecordHeader is fully optional.** Every prop except `recordType` and
   `title` is optional; the metadata row is omitted entirely when no meta
   field is provided, so a bare record shows no empty slots. Long titles
   truncate; contributors collapse to a `+N` avatar group after five.

3. **Inspector is stateless and URL-friendly.** It takes `tabs`,
   `defaultTab`, `state` and `onClose` as props and holds no record
   selection state. A consuming route drives `state` and tab content from
   its own data and from URL search params; the component never fights the
   URL. Tabs are uncontrolled (Radix `defaultValue`) so switching is cheap
   and deterministic.

4. **Independent scroll, pinned identity.** The identity header (type +
   title + close) and the tab list are outside/above the scroll region; only
   tab content scrolls. The tab list is sticky within the scroll region so
   it stays visible while content moves.

5. **Four honest states.** `state: 'skeleton' | 'no-selection' |
'unavailable' | 'permission-denied' | 'loaded'`. Non-loaded states
   replace the tab region with a centred message (and a shimmer for
   skeleton) and never show stale content.

6. **Sections communicate by text, not colour alone.** `CheckList` exposes
   each check's state as `sr-only` text in addition to its icon/colour.
   Empty lists render an `EmptyHint` rather than disappearing.

7. **A `Skeleton` primitive** is added to `src/components/ui` (aria-hidden,
   pulse-only) for the skeleton state and future loading states.

## Consequences

- `/foundations` gains a live "Record header & inspector" review section so
  reviewers can compare with the mockups without an authenticated session.
- UI-005 hardens `PropertyList`/`RecordLink`/`StatusBadge` and UI-007
  hardens `AuditTrail`/`ApprovalStepper` against the contracts here; the
  section components stay drop-in.
- The first real record route (ELN phase) wires selection through URL
  search params and passes the result to `Inspector`; no component change
  is needed for deep linking.
