import type { ComparisonPair } from '#/components/component-compare/types'
import { nativeSelectPair } from '#/components/component-compare/pairs/native-select'
import { notebookSortablePair } from '#/components/component-compare/pairs/notebook-sortable'

/**
 * The registered comparison pairs, in the order the harness lists them.
 *
 * A pair is added when a screen that uses the component is touched — not on
 * spec. Each entry names the job, the two implementations and the control
 * classes they have; the checklist items for absent controls are recorded as
 * not applicable rather than left blank.
 */
export const COMPARISON_PAIRS: readonly ComparisonPair[] = Object.freeze([
  notebookSortablePair,
  nativeSelectPair,
])
