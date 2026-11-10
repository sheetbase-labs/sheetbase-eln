/**
 * The materials registry's vocabulary and its list derivation.
 *
 * The route module keeps the screen; this module owns the tab names, the date
 * and stock formatters and the pure filtering that turns reagent pages into the
 * lots a tab lists.
 */
import { now as appNow } from '#/lib/clock'
import { t } from '#/copy'
import {
  NO_PROJECT_ACCESS_BODY,
  noProjectAccessTitle,
} from '#/components/projects/project-access'
import type { MaterialListRow } from '#/components/materials/materials-data'
import type { Reagent } from '#/lib/reagent-data'
import type { ReagentOrder } from '#/lib/reagent-orders'

export const tabs = [
  'instock',
  'expiring',
  'quarantine',
  'expired',
  'archived',
  'orders',
  'spend',
] as const

export type MaterialTab = (typeof tabs)[number]

/** A failed write's own message, or the screen's words when it has none. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A mutation failure is a caught throw, untyped by definition; Error supplies its message and anything else falls back.
export function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Today as a date input states it — the local calendar day, because that is
 * what a `type=date` field hands back. */
export function todayISO(): string {
  const now = appNow()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')

  return `${now.getFullYear()}-${month}-${day}`
}

/** The inspector states dates in full, e.g. "4 Jun 2026". */
export function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Day and month, for the compact usage line ("23 Sep"). */
export function shortDay(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return ''

  return `${date.getUTCDate()} ${date
    .toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    .slice(0, 3)}`
}

/** "2 of 6 units": what is left of what was received. */
export function stockOfTotal(row: MaterialListRow): string {
  const unit = row.unit ? ` ${row.unit}` : ''
  const current = row.stock

  if (row.initialQuantity == null) return current

  const total = row.initialQuantity.toLocaleString('en-GB', {
    maximumFractionDigits: 2,
  })

  return `${current.replace(unit, '')} of ${total}${unit}`
}

/** Hidden when the pane is narrow (see workspace.css), so the last column is never cut off. */
export const NARROW_HIDE = {
  headerClassName: 'hide-in-narrow-pane',
  cellClassName: 'hide-in-narrow-pane',
}

/** The `expiring` tab is each lot's own expiry warning window (30 days by
 * default, overridable per lot in its reagent properties), so its label claims
 * no fixed window. */
export const tabLabel: Record<MaterialTab, string> = {
  instock: t('library.materials.page.inStock'),
  expiring: t('library.materials.page.expiringSoon'),
  quarantine: 'Quarantine',
  expired: 'Expired',
  archived: t('library.materials.page.archived'),
  orders: t('library.materials.orders.tab'),
  spend: t('spend.spendReport.tab'),
}

/** Whether a lot belongs to a tab. */
export function isMaterialInTab(
  row: MaterialListRow,
  tab: MaterialTab,
): boolean {
  return row.tabs.includes(tab)
}

/**
 * Soonest expiry first, so the lot that lapses next leads the list; a lot with
 * no expiry is not imminent and sorts after every dated one. A click on a
 * column header takes over from this order.
 */
export function sortReagentsByExpiry(reagents: readonly Reagent[]): Reagent[] {
  const byExpiry = (a: Reagent, b: Reagent) => {
    if (a.expiry === b.expiry) return 0

    if (a.expiry === null) return 1

    if (b.expiry === null) return -1

    return a.expiry.localeCompare(b.expiry)
  }

  return [...reagents].sort(byExpiry)
}

/** The tab counts: each lot tab's own rows, the open orders, and a zero for
 * Spend, which is a report rather than a list of lots. */
export function materialTabCounts({
  rows,
  orders,
  archivedCount,
}: {
  rows: readonly MaterialListRow[]
  orders: readonly ReagentOrder[]
  archivedCount: number
}) {
  return Object.fromEntries(
    tabs.map((item): [MaterialTab, number] => [
      item,
      item === 'orders'
        ? orders.filter(
            (order) =>
              order.status === 'requested' || order.status === 'ordered',
          ).length
        : item === 'spend'
          ? 0
          : item === 'archived'
            ? archivedCount
            : rows.filter((row) => isMaterialInTab(row, item)).length,
    ]),
  )
}

/** The lots a tab lists, narrowed by the search box. */
export function visibleMaterials({
  rows,
  tab,
  query,
}: {
  rows: readonly MaterialListRow[]
  tab: MaterialTab
  query: string
}): MaterialListRow[] {
  const q = query.trim().toLowerCase()

  return rows
    .filter((row) => isMaterialInTab(row, tab))
    .filter(
      (row) =>
        !q ||
        [row.id, row.name, row.supplier, row.lot, row.location].some((value) =>
          value.toLowerCase().includes(q),
        ),
    )
}

/**
 * A link such as `?selected=<lot>` names a lot, not a tab. When that lot lives
 * on another tab (an expired or quarantined lot, say) this is the tab that
 * holds it, so the page can move there instead of selecting the first row of
 * the wrong list.
 */
export function linkedMaterialTab({
  rows,
  selected,
  tab,
}: {
  rows: readonly MaterialListRow[]
  selected: string | undefined
  tab: MaterialTab
}): MaterialTab | undefined {
  const linked = selected
    ? rows.find((row) => row.uuid === selected)
    : undefined

  return linked && !isMaterialInTab(linked, tab)
    ? tabs.find((item) => isMaterialInTab(linked, item))
    : undefined
}

/** The tab the page shows: Spend needs the capability that reads prices, and
 * falls back to In stock without it. */
export function materialsTab({
  requested,
  canPlaceOrders,
}: {
  requested: MaterialTab | undefined
  canPlaceOrders: boolean
}): MaterialTab {
  return requested === 'spend' && !canPlaceOrders
    ? 'instock'
    : (requested ?? 'instock')
}

/** Orders and Spend are panels of their own, not lists of lots. */
export function isMaterialPanelTab(tab: MaterialTab): boolean {
  return tab === 'orders' || tab === 'spend'
}

/** What the empty state offers: no action, the way out of a search or tab, or
 * the way to register the first lot. */
export type MaterialsEmptyAction = 'none' | 'clear' | 'back' | 'register'

export interface MaterialsEmptyCopy {
  icon: 'search' | 'box'
  title: string
  description: string
  action: MaterialsEmptyAction
}

/** The words the empty state states, and what it offers from there. */
export function materialsEmptyState({
  tab,
  query,
  searchTerm,
  hasProjectAccess,
}: {
  tab: MaterialTab
  /** Whether a search narrowed the list, as the trimmed query the filter uses. */
  query: boolean
  searchTerm: string | undefined
  hasProjectAccess: boolean | undefined
}): MaterialsEmptyCopy {
  const icon = query ? 'search' : 'box'

  if (hasProjectAccess === false) {
    return {
      icon,
      title: noProjectAccessTitle('materials'),
      description: NO_PROJECT_ACCESS_BODY,
      action: 'none',
    }
  }

  const title = query
    ? t('library.materials.page.noMaterialLotsMatch', { q: searchTerm ?? '' })
    : tab === 'instock'
      ? t('library.materials.page.noLotsInStock')
      : tab === 'archived'
        ? t('library.materials.page.noArchivedLots')
        : t('library.materials.page.noLots', {
            toLowerCase: tabLabel[tab].toLowerCase(),
          })

  const description = query
    ? t('library.materials.page.searchLooksAtIdMaterial')
    : tab === 'instock'
      ? t('library.materials.page.registerAMaterialLotTo')
      : tab === 'archived'
        ? t('library.materials.page.archivedStayHere')
        : t('library.materials.page.lotsAppearHereWhenTheir')

  return {
    icon,
    title,
    description,
    action: query ? 'clear' : tab !== 'instock' ? 'back' : 'register',
  }
}
