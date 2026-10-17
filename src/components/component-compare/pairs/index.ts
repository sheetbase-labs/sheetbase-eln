import type { ComparisonPair } from '#/components/component-compare/types'
import { historyRowsPair } from '#/components/component-compare/pairs/history-rows'
import { nativeSelectPair } from '#/components/component-compare/pairs/native-select'
import { notebookSortablePair } from '#/components/component-compare/pairs/notebook-sortable'
import { emptyStatePair } from '#/components/component-compare/pairs/empty-state'
import { quantityFieldPair } from '#/components/component-compare/pairs/quantity-field'
import { shortcutKeysPair } from '#/components/component-compare/pairs/shortcut-keys'
import { fileUploadPair } from '#/components/component-compare/pairs/file-upload'
import { registryGridPair } from '#/components/component-compare/pairs/registry-grid'
import { tabFamilyPair } from '#/components/component-compare/pairs/tab-family'
import { pressedChipsPair } from '#/components/component-compare/pairs/pressed-chips'
import { spinnerPair } from '#/components/component-compare/pairs/spinner'
import { progressPair } from '#/components/component-compare/pairs/progress'
import { collapsiblePair } from '#/components/component-compare/pairs/collapsible'
import { payloadBlockPair } from '#/components/component-compare/pairs/payload-block'

/**
 * The registered comparison pairs, in the order the harness lists them.
 *
 * A pair is added when a screen that uses the component is touched — not on
 * spec. Each entry names the job, the two implementations and the control
 * classes they have; the checklist items for absent controls are recorded as
 * not applicable rather than left blank.
 *
 * Pairs 2–5 are the small primitives batch. Their `theirs` column is an
 * in-house v3 component rather than a registry item, because the pinned
 * base-nova registry has no item for three of the four jobs (`spinner`,
 * `progress`, `collapsible` and `accordion` are stock shadcn, and 404 there),
 * and a bare-name install writes into the legacy Radix kit ADR-0055 decision 1
 * refuses to extend. The fourth, `@reui/code-block`, does exist and was
 * measured; the record carries the numbers and the decline. What every one of
 * these rows decides is the componentisation itself — one component against
 * four to six spellings — and the measurement is a real before/after on the
 * same fixtures.
 */
export const COMPARISON_PAIRS: readonly ComparisonPair[] = Object.freeze([
  notebookSortablePair,
  emptyStatePair,
  historyRowsPair,
  quantityFieldPair,
  shortcutKeysPair,
  fileUploadPair,
  registryGridPair,
  nativeSelectPair,
  tabFamilyPair,
  pressedChipsPair,
  spinnerPair,
  progressPair,
  collapsiblePair,
  payloadBlockPair,
])
