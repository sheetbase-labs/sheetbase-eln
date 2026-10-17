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
  emptyStatePair,
  historyRowsPair,
  quantityFieldPair,
  shortcutKeysPair,
  fileUploadPair,
  registryGridPair,
  nativeSelectPair,
  tabFamilyPair,
  pressedChipsPair,
])
