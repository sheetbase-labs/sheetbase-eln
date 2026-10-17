import type { ComparisonPair } from '#/components/component-compare/types'
import { notebookSortablePair } from '#/components/component-compare/pairs/notebook-sortable'
import { pagingAListPair } from '#/components/component-compare/pairs/paging-a-list'
import { loadMoreControlPair } from '#/components/component-compare/pairs/load-more-control'
import { listHeaderPair } from '#/components/component-compare/pairs/list-header'
import { breadcrumbTrailPair } from '#/components/component-compare/pairs/breadcrumb-trail'

/**
 * The registered comparison pairs, in the order the harness lists them.
 *
 * A pair is added when a screen that uses the component is touched — not on
 * spec. Each entry names the job, the two implementations and the control
 * classes they have; the checklist items for absent controls are recorded as
 * not applicable rather than left blank.
 *
 * The first entry is the harness's default, which the browser spec
 * (`tests/browser/component-compare.test.ts`) drives, so it stays the notebook's
 * reorderable list.
 */
export const COMPARISON_PAIRS: readonly ComparisonPair[] = Object.freeze([
  notebookSortablePair,
  pagingAListPair,
  loadMoreControlPair,
  listHeaderPair,
  breadcrumbTrailPair,
])
