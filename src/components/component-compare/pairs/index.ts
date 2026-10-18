import type { ComparisonPair } from '#/components/component-compare/types'
import { historyRowsPair } from '#/components/component-compare/pairs/history-rows'
import { nativeSelectPair } from '#/components/component-compare/pairs/native-select'
import { avatarInitialsPair } from '#/components/component-compare/pairs/avatar-initials'
import { fileTypePair } from '#/components/component-compare/pairs/file-type'
import { noticeBannerPair } from '#/components/component-compare/pairs/notice-banner'
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
 * (`tests/browser/component-compare.test.ts`) drives through its generic
 * checks, so it stays the notebook's reorderable list.
 *
 * Several pairs' `theirs` column is an in-house v3 component rather than a
 * registry item, because the pinned base-nova registry has no item for the job
 * (`spinner`, `progress`, `collapsible`, `accordion`, `pagination`, `tabs`,
 * `toggle-group`, `select`, `breadcrumb` and `empty` are stock shadcn and 404
 * there), and a bare-name install writes into the legacy Radix kit ADR-0055
 * decision 1 refuses to extend. `@reui/code-block` does exist and was measured;
 * the record carries the numbers and the decline. What those rows decide is the
 * componentisation itself — one component against several spellings — and the
 * measurement is a real before/after on the same fixtures.
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
  avatarInitialsPair,
  noticeBannerPair,
  fileTypePair,
  pagingAListPair,
  loadMoreControlPair,
  listHeaderPair,
  breadcrumbTrailPair,
])
