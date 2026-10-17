import type { ComponentType } from 'react'

/**
 * The contracts an A/B component comparison is built from (ADR-0055).
 *
 * A *pair* names a generic UI job and the two components that do it: the one
 * the repository uses now, and the candidate. When the candidate is adopted it
 * becomes what the repository uses, and the pair's comparison of two mechanisms
 * is spent — but the pair is not automatically retired: its job then changes to
 * holding the adopted *integration* against the registry item as published,
 * which is where an adoption's regressions actually appear (container
 * semantics, handle placement, restyling). Row 1 of
 * `docs/knowledge/design/component-comparison-record.md` is that case, and the
 * original comparison stays in the record as history.
 *
 * A *fixture* is the data both columns render — the same object, not a copy per
 * side. A *scenario* is one fixture plus the state the column is in, and it is
 * handed to both sides unchanged.
 *
 * Nothing here knows about any particular component: a new pair is data, and a
 * new job is a new entry in `checklist.ts`, not a new comparator.
 */

/** Which column a component is. */
export type ComparisonSideId = 'ours' | 'theirs'

/**
 * The states every column must be able to show. `ready` renders the fixture;
 * `loading`, `error` and `restricted` are the states a screen meets around it
 * — and `restricted` is the one where permission changes the controls.
 */
export const COMPARISON_STATES = [
  'ready',
  'loading',
  'error',
  'restricted',
] as const
export type ComparisonState = (typeof COMPARISON_STATES)[number]

/**
 * A control class the fixed checklist can exercise. A pair declares which ones
 * its components have; checklist items for the others are recorded as not
 * applicable rather than skipped silently.
 */
export const COMPARISON_CONTROLS = [
  'reorder',
  'sort',
  'filter',
  'select',
  'resize',
  'pagination',
  'picker',
] as const
export type ComparisonControl = (typeof COMPARISON_CONTROLS)[number]

/**
 * One shared data fixture. Every fixture is hostile on one named axis, so a
 * checklist result can say which condition produced it.
 */
export interface ComparisonFixture {
  readonly id: string
  /** The axis of hostility, e.g. "5,000 rows". */
  readonly hostility: string
  readonly description: string
  readonly rows: readonly ComparisonRow[]
}

/** One row of a fixture: what a list, grid or table column has to render. */
export interface ComparisonRow {
  readonly id: string
  /** Scientific name; very long in the long-labels fixture. */
  readonly name: string
  /** Unit of measure; very long in the long-labels fixture. */
  readonly unit: string
  /** Mixed across fixtures by design: number, string or null. */
  readonly value: number | string | null
  /** Wholly null in the null-column fixture. */
  readonly note: string | null
  readonly kind: 'Sample' | 'Control' | 'Standard' | null
}

/** One fixture, one state: what both columns are asked to render. */
export interface ComparisonScenario {
  readonly fixture: ComparisonFixture
  readonly state: ComparisonState
  /**
   * The retry a real screen would offer from its error state. It is part of the
   * scenario rather than of a column because both sides must be given the same
   * one, and it does something: the harness returns to `ready`.
   */
  readonly onRetry: () => void
}

/** Props of a column component: the shared scenario, never a per-side copy. */
export interface ComparisonColumnProps {
  readonly scenario: ComparisonScenario
}

/** One side of a pair. */
export interface ComparisonSide {
  readonly id: ComparisonSideId
  /**
   * Column heading, e.g. "Ours — notebook list (ReUI sortable adopted)", or
   * "Reference — ReUI sortable with the C1 semantics fix-up" for the item a
   * pair's ours side was adopted from.
   */
  readonly label: string
  /**
   * Where the implementation lives: a repository path, or the registry item
   * and version it was installed from. The record cites this.
   */
  readonly source: string
  readonly Column: ComponentType<ComparisonColumnProps>
}

/** A generic UI job, done twice. */
export interface ComparisonPair {
  readonly id: string
  readonly title: string
  /** The generic UI job both sides do, in one line. */
  readonly job: string
  /** Which checklist control classes this pair's components actually have. */
  readonly controls: readonly ComparisonControl[]
  readonly ours: ComparisonSide
  readonly theirs: ComparisonSide
}
