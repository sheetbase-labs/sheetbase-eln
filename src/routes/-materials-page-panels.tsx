/**
 * The materials registry's rendered panels: the page header with its actions
 * and tabs, the list body with its toolbar and empty state, and the lot
 * inspector.
 */
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Status } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { DescriptionList, Inspector } from '#/components/ui/layout'
import {
  HazardPictograms,
  MaterialSafetySection,
} from '#/components/materials/material-safety'
import type { GhsPictogram } from '#/lib/material-safety'
import {
  ORDER_TONE,
  orderStatusLabel,
} from '#/components/materials/reagent-order-model'
import type { ReagentOrder } from '#/lib/reagent-orders'
import type {
  CertificateFile,
  ReagentUsageLink,
  ReplacementLotLink,
} from '#/lib/reagent-data'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type {
  RegistryColumn,
  useRowFocus,
} from '#/components/inventory/registry-grid'
import {
  ListFooter,
  ListHeader,
  ReadOnlyNote,
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/inventory/list'
import { Tabs } from '#/components/ui/tabs'
import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { t } from '#/copy'

import {
  dayLabel,
  materialsEmptyState,
  shortDay,
  stockOfTotal,
  tabLabel,
  tabs,
} from './-materials-page-model'
import type { MaterialTab } from './-materials-page-model'
import type { MaterialsReads } from './-materials-page-data'

/** The sheet the page lives on: the registry list or the nested lot page. */
type RowFocus = ReturnType<typeof useRowFocus>

/** The page header: what the registry is, its actions and its tabs. */
export function MaterialsHeader({
  canWrite,
  canPlaceOrders,
  sel,
  page,
  orders,
  archivedCount,
  counts,
  searchQuery,
  tab,
  onRegister,
  onReceive,
  onSolution,
}: {
  canWrite: boolean
  canPlaceOrders: boolean
  sel: MaterialListRow | undefined
  page: MaterialsReads['page']
  orders: MaterialsReads['orders']
  archivedCount: MaterialsReads['archivedCount']
  counts: Record<string, number>
  searchQuery: string | undefined
  tab: MaterialTab
  onRegister: () => void
  onReceive: () => void
  onSolution: () => void
}): React.ReactElement {
  return (
    <ListHeader
      title={t('library.materials.page.materials')}
      total={page.data?.total}
      actions={
        <>
          <IconButton
            variant="secondary"
            icon="scan"
            label={t('library.materials.page.scanLabel')}
            nativeButton={false}
            render={<Link to="/scan" />}
          />
          {canWrite ? (
            <>
              <Button
                variant={sel ? 'secondary' : 'primary'}
                // On a phone Receive lot sits in More, so Register lot is
                // the one main action and always reads as primary.
                className="max-md:border-primary max-md:bg-primary max-md:text-primary-foreground max-md:hover:bg-primary-hover max-md:hover:text-primary-foreground"
                onClick={onRegister}
              >
                {t('library.materials.page.registerLot')}
              </Button>
              <Button
                className="max-md:hidden"
                variant={sel ? 'primary' : 'secondary'}
                disabled={!sel}
                title={
                  sel
                    ? undefined
                    : t('library.materials.page.selectALotToReceive')
                }
                onClick={onReceive}
              >
                {t('library.materials.page.receiveLot')}
              </Button>
              <Button
                className="max-md:hidden"
                variant="secondary"
                title={t('library.materials.solution.actionHint')}
                onClick={onSolution}
              >
                {t('library.materials.solution.action')}
              </Button>
              {/* A phone has room for Scan and Register lot: the rest sit
                      in More, as on Samples. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton
                      variant="secondary"
                      className="md:hidden"
                      icon="more"
                      label={t('common.actions.more')}
                    />
                  }
                />
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem disabled={!sel} onClick={onReceive}>
                    {t('library.materials.page.receiveLot')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onSolution}>
                    {t('library.materials.solution.action')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <ReadOnlyNote>
              {t('common.readOnly.cannotAdd', {
                things: t('common.readOnly.things.materials'),
              })}
            </ReadOnlyNote>
          )}
        </>
      }
      tabs={
        <Tabs
          mode="url"
          label={t('library.materials.page.materialLists')}
          value={tab}
          items={tabs.flatMap((item) =>
            item !== 'spend' || canPlaceOrders
              ? [
                  {
                    key: item,
                    label: tabLabel[item],
                    count:
                      item === 'spend'
                        ? undefined
                        : (
                              item === 'orders'
                                ? orders.isPending
                                : item === 'archived'
                                  ? archivedCount.isPending
                                  : page.isPending
                            )
                          ? undefined
                          : counts[item],
                    link: {
                      to: '/materials',
                      search: {
                        tab: item === 'instock' ? undefined : item,
                        q: searchQuery ?? '',
                      },
                    },
                  },
                ]
              : [],
          )}
        />
      }
    />
  )
}

/** Nothing in this tab, or nothing matching the search. */
export function MaterialsEmptyState({
  tab,
  query,
  searchTerm,
  hasProjectAccess,
  onRegister,
}: {
  tab: MaterialTab
  query: boolean
  searchTerm: string | undefined
  hasProjectAccess: boolean | undefined
  onRegister: () => void
}): React.ReactElement {
  const copy = materialsEmptyState({
    tab,
    query,
    searchTerm,
    hasProjectAccess,
  })

  let action: React.ReactElement | undefined

  if (copy.action === 'register') {
    action = (
      <Button variant="primary" onClick={onRegister}>
        {t('library.materials.page.registerLot')}
      </Button>
    )
  }

  if (copy.action === 'clear' || copy.action === 'back') {
    action = (
      <Button
        nativeButton={false}
        render={
          <Link
            to="/materials"
            search={{ tab: !query && tab !== 'instock' ? undefined : tab }}
          />
        }
      >
        {copy.action === 'clear'
          ? t('library.materials.page.clearSearch')
          : t('library.materials.page.backToInStock')}
      </Button>
    )
  }

  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        className="items-center py-14 text-center"
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
        action={action}
      />
    </div>
  )
}

/** The list body: the search, the bulk actions, the grid, the phone list, the
 * empty state and the count footer. */
export function MaterialsBody({
  tab,
  panelTab,
  searchQuery,
  counts,
  visible,
  sel,
  view,
  bulk,
  columns,
  rowFocus,
  page,
  hasProjectAccess,
  canWrite,
  onRegister,
  onSearch,
  onBulkChanged,
  onOpenMaterial,
}: {
  tab: MaterialTab
  panelTab: boolean
  searchQuery: string | undefined
  counts: Record<string, number>
  visible: MaterialListRow[]
  sel: MaterialListRow | undefined
  view: MaterialsReads['view']
  bulk: MaterialsReads['bulk']
  columns: RegistryColumn<MaterialListRow>[]
  rowFocus: RowFocus
  page: MaterialsReads['page']
  hasProjectAccess: boolean | undefined
  canWrite: boolean
  onRegister: () => void
  onSearch: (next: string) => void
  onBulkChanged: () => void
  onOpenMaterial: (row: MaterialListRow, event?: React.MouseEvent) => void
}): React.ReactElement | null {
  if (panelTab) return null

  const query = (searchQuery ?? '').trim().toLowerCase()

  return (
    <>
      <ListToolbar
        q={searchQuery}
        label={t('library.materials.page.searchMaterials')}
        placeholder={t('library.materials.page.searchByIdMaterialSupplier')}
        onSearch={onSearch}
      />
      <RecordBulkBar
        selection={bulk}
        kind="material"
        restore={tab === 'archived'}
        canWrite={canWrite}
        onChanged={onBulkChanged}
      />
      <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
        {page.isPending || visible.length > 0 ? (
          <RegistryGrid
            className="max-md:hidden"
            label={t('library.materials.page.materialLots')}
            view={view}
            bulk={bulk}
            rowLabel={(m) => m.id}
            rows={visible}
            columns={columns}
            getRowId={(m) => m.uuid}
            rowSelection={rowFocus.rowSelection}
            onRowSelectionChange={rowFocus.onRowSelectionChange}
            onRowClick={onOpenMaterial}
            isLoading={page.isPending}
          />
        ) : null}
        <MobileList
          label={t('library.materials.page.materialLots')}
          items={visible.map((m) => ({
            key: m.uuid,
            id: m.id,
            title: m.name,
            sub: `${m.stock} · ${m.location}`,
            status: <Status tone={m.status.tone}>{m.status.label}</Status>,
            link: {
              to: '/materials/$lotId',
              params: { lotId: m.uuid },
              onClick: (event: React.MouseEvent) => onOpenMaterial(m, event),
            },
            selected: m.uuid === sel?.uuid,
          }))}
        />
        {!page.isPending && visible.length === 0 ? (
          <MaterialsEmptyState
            tab={tab}
            query={query.length > 0}
            searchTerm={searchQuery}
            hasProjectAccess={hasProjectAccess}
            onRegister={onRegister}
          />
        ) : null}
      </div>
      <ListFooter
        loading={page.isPending}
        right={sel ? '1 selected' : undefined}
      >
        {footerCount({
          shown: visible.length,
          total: counts[tab],
          one: 'material lot',
          tab: tabLabel[tab],
        })}
      </ListFooter>
    </>
  )
}

/** The lot's identity and the actions the inspector offers on it. */
export function MaterialInspectorHeader({
  sel,
  safetyPictograms,
  openOrder,
  canWrite,
  restoring,
  quarantining,
  onRegisterReplacement,
  onRequestReorder,
  onRestore,
  onQuarantine,
}: {
  sel: MaterialListRow
  safetyPictograms: readonly GhsPictogram[] | undefined
  openOrder: ReagentOrder | undefined
  canWrite: boolean
  restoring: boolean
  quarantining: boolean
  onRegisterReplacement: () => void
  onRequestReorder: () => void
  onRestore: () => void
  onQuarantine: () => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
      <span className="mono text-fg-muted">
        {t('library.materials.page.lot', { id: sel.id, lot: sel.lot })}
      </span>
      <div className="font-heading text-doc font-semibold">{sel.name}</div>
      {sel.expiryNote ? (
        <div className="text-label">
          <Status tone={sel.status.tone}>{sel.expiryNote}</Status>
        </div>
      ) : null}
      <HazardPictograms
        pictograms={safetyPictograms ?? []}
        size={28}
        className="mt-0.5"
      />
      {sel.attention?.label === 'Low stock' ? (
        <div className="text-label">
          <Status tone={sel.attention.tone}>{sel.attention.label}</Status>
          {openOrder ? null : (
            <span className="ml-2 text-fg-muted">
              {t('library.materials.orders.lowStockHint')}
            </span>
          )}
        </div>
      ) : null}
      {openOrder ? (
        <div className="text-label">
          <Link
            to="/materials"
            search={{ tab: 'orders' }}
            className="hover:underline"
          >
            <Status tone={ORDER_TONE[openOrder.status]}>
              {t('library.materials.orders.openOrderValue', {
                reference: openOrder.reference,
                status: orderStatusLabel(openOrder.status),
              })}
            </Status>
          </Link>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          nativeButton={false}
          render={<Link to="/materials/$lotId" params={{ lotId: sel.uuid }} />}
        >
          {t('library.materials.page.openLot')}
        </Button>
        <Button
          variant={
            canWrite && !openOrder && sel.attention?.label === 'Low stock'
              ? 'secondary'
              : 'primary'
          }
          size="sm"
          onClick={onRegisterReplacement}
        >
          {t('library.materials.page.registerReplacementLot')}
        </Button>
        {canWrite && !openOrder ? (
          <Button
            variant={
              sel.attention?.label === 'Low stock' ? 'primary' : 'secondary'
            }
            size="sm"
            onClick={onRequestReorder}
          >
            {t('library.materials.orders.requestReorder')}
          </Button>
        ) : null}
        {sel.tabs.includes('quarantine') ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={restoring}
            onClick={onRestore}
          >
            {restoring
              ? t('library.materials.page.restoring')
              : t('common.actions.restore')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={quarantining}
            onClick={onQuarantine}
          >
            {t('library.materials.page.quarantine')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** What is known about the lot: its fields, its safety, its replacement and
 * where it has been used. */
export function MaterialInspectorFacts({
  sel,
  canWrite,
  certificate,
  replacementLink,
  usage,
}: {
  sel: MaterialListRow
  canWrite: boolean
  certificate: CertificateFile | null | undefined
  replacementLink: ReplacementLotLink | null | undefined
  usage: ReagentUsageLink[]
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      {/* The registry's inspector is a top-level section of the page, so
                its headings are H2 (H1 → H2, no skipped level). */}
      <section>
        <h2 className="mb-1.5 font-sans text-label font-semibold">
          {t('library.materials.page.lot2')}
        </h2>
        <DescriptionList
          labelWidth={88}
          items={[
            [
              'Supplier',
              sel.catalogNo
                ? `${sel.supplier} · cat. ${sel.catalogNo}`
                : sel.supplier,
            ],
            ['Received', dayLabel(sel.received)],
            [
              t('library.materials.page.releasedBy'),
              sel.releasedBy
                ? `${sel.releasedBy} · ${dayLabel(sel.releasedAt)}`
                : '—',
            ],
            [
              'Certificate',
              certificate ? (
                <Link
                  to="/records/$recordId"
                  params={{ recordId: certificate.fileRecordId }}
                  className="hover:underline"
                >
                  {certificate.displayName}
                </Link>
              ) : (
                (sel.certificate ?? '—')
              ),
            ],
            ['Stock', stockOfTotal(sel)],
          ]}
        />
      </section>
      <MaterialSafetySection
        recordId={sel.uuid}
        name={sel.name}
        projectId={sel.projectId}
        canEdit={canWrite}
      />
      <section>
        <h2 className="mb-1.5 font-sans text-label font-semibold">
          {replacementLink
            ? t('library.materials.page.replacementLot')
            : t('library.materials.page.noReplacementLot')}
        </h2>
        <p className="text-label text-fg-muted">
          {replacementLink
            ? `${replacementLink.targetIdentifier}${replacementLink.reason ? ` · ${replacementLink.reason}` : ''}`
            : t('library.materials.page.noLotHasBeenRegistered')}
        </p>
      </section>
      {usage.length ? (
        <section>
          <h2 className="mb-1.5 font-sans text-label font-semibold">
            {t('library.materials.page.usedIn')}
          </h2>
          <ul className="flex flex-col gap-1">
            {usage.map((link) => (
              <li key={link.id} className="text-label">
                {link.sourceRecordId ? (
                  <Link
                    to="/records/$recordId"
                    params={{ recordId: link.sourceRecordId }}
                    className="mono hover:underline"
                  >
                    {link.sourceIdentifier}
                  </Link>
                ) : (
                  link.sourceIdentifier
                )}
                {link.quantity != null
                  ? ` · ${link.quantity.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${link.unit ? ` ${link.quantity === 1 ? link.unit.replace(/s$/, '') : link.unit}` : ''}, ${shortDay(link.createdAt)}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/** The open lot's inspector: its identity, its actions and what is known about
 * it. */
export function MaterialInspector({
  sel,
  safetyPictograms,
  openOrder,
  canWrite,
  certificate,
  replacementLink,
  usage,
  restoring,
  quarantining,
  onRegisterReplacement,
  onRequestReorder,
  onRestore,
  onQuarantine,
}: {
  sel: MaterialListRow
  safetyPictograms: readonly GhsPictogram[] | undefined
  openOrder: ReagentOrder | undefined
  canWrite: boolean
  certificate: CertificateFile | null | undefined
  replacementLink: ReplacementLotLink | null | undefined
  usage: ReagentUsageLink[]
  restoring: boolean
  quarantining: boolean
  onRegisterReplacement: () => void
  onRequestReorder: () => void
  onRestore: () => void
  onQuarantine: () => void
}): React.ReactElement {
  return (
    <Inspector
      aria-label={t('library.materials.page.materialLot')}
      className="gap-0 p-0"
    >
      <MaterialInspectorHeader
        sel={sel}
        safetyPictograms={safetyPictograms}
        openOrder={openOrder}
        canWrite={canWrite}
        restoring={restoring}
        quarantining={quarantining}
        onRegisterReplacement={onRegisterReplacement}
        onRequestReorder={onRequestReorder}
        onRestore={onRestore}
        onQuarantine={onQuarantine}
      />
      <MaterialInspectorFacts
        sel={sel}
        canWrite={canWrite}
        certificate={certificate}
        replacementLink={replacementLink}
        usage={usage}
      />
    </Inspector>
  )
}
