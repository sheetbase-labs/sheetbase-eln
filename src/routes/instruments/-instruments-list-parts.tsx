/**
 * The Instruments registry's presentational sections: the denied state, the
 * header and its tabs, the filter toolbar, the table (with its empty states)
 * and the footer.
 *
 * Each section reads the list model and reports intent back; none of them
 * fetch, filter or own the selection.
 */
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Dot } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { Select } from '#/components/ui/select'
import { Tabs } from '#/components/ui/tabs'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
} from '#/components/inventory/list'
import { WorkspaceAdminsLine } from '#/components/settings/workspace-admins-line'
import {
  CALIBRATION_DUE_SOON_DAYS,
  INTAKE_METHODS,
  intakeMethodLabel,
  isOutOfService,
} from '#/components/instruments/instruments-data'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import { RegisterInstrument } from './-instruments-register'
import type { InstrumentsListModel } from './-instruments-model'
import { tabCountLabels, tabLabels } from './-instruments-model'

/** The registry when the workspace will not open it to this person. */
export function InstrumentsDenied({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader title={t('library.instruments.list.instruments')} />
      <div className="px-4 md:px-6">
        <EmptyState
          icon="lock"
          title={t('library.instruments.list.youDontHaveAccessTo')}
          description={
            <>
              {t('library.instruments.list.theRegistryIsOpenTo')}
              <WorkspaceAdminsLine workspaceId={workspaceId} />
            </>
          }
          action={
            <Button nativeButton={false} render={<Link to="/schedule" />}>
              {t('library.instruments.list.bookAnInstrumentInstead')}
            </Button>
          }
        />
      </div>
    </div>
  )
}

/** The page title, its two actions, and the tab row with each tab's count. */
export function InstrumentsHeader({
  list,
  autoOpen,
  onAutoOpened,
}: {
  list: InstrumentsListModel
  autoOpen: boolean
  onAutoOpened: () => void
}) {
  const { query, inService, search, tab, counts } = list

  return (
    <ListHeader
      title={t('library.instruments.list.instruments')}
      total={query.isPending ? undefined : inService.length}
      actions={
        <>
          <Button
            className="max-md:hidden"
            nativeButton={false}
            render={<Link to="/settings/lab/instruments" />}
          >
            {t('library.instruments.list.parsers')}
          </Button>
          {list.canManageInstruments ? (
            <RegisterInstrument
              types={list.types}
              workspaceId={list.workspaceId}
              ownerId={list.ownerId}
              autoOpen={autoOpen}
              onAutoOpened={onAutoOpened}
            />
          ) : null}
        </>
      }
      tabs={
        <Tabs
          mode="url"
          label={t('library.instruments.list.instrumentLists')}
          value={tab}
          items={(
            ['all', 'connected', 'calibration', 'retired', 'usage'] as const
          ).map((key) => ({
            key,
            label: tabLabels[key],
            count: query.isPending || key === 'usage' ? undefined : counts[key],
            link: {
              to: '/instruments',
              search: {
                ...search,
                tab: key === 'all' ? undefined : key,
                selected: undefined,
              },
            },
          }))}
        />
      }
    />
  )
}

/** Search, and the three registry filters, in the list toolbar. */
export function InstrumentsFilters({ list }: { list: InstrumentsListModel }) {
  const { search, types, setParam, navigate } = list

  return (
    <ListToolbar
      q={search.q}
      label={t('library.instruments.list.searchInstruments')}
      placeholder={t('library.instruments.list.searchIdNameModelSerial')}
      onSearch={(next) =>
        void navigate({
          to: '/instruments',
          search: (s) => ({ ...s, q: next || undefined }),
          replace: true,
        })
      }
      right={
        <div className="flex shrink-0 items-center gap-1 max-md:hidden">
          <label className="flex items-center gap-1 text-label text-fg-muted">
            {t('library.instruments.list.type')}
            <Select
              aria-label={t('library.instruments.list.filterByType')}
              className="h-[26px] w-32 text-label"
              value={search.type ?? ''}
              onChange={(e) => setParam('type')(e.target.value)}
            >
              <option value="">{t('library.instruments.list.any')}</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {instrumentTypeLabel(item)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1 text-label text-fg-muted">
            {t('library.instruments.list.howDataGetsIn')}
            <Select
              aria-label={t('library.instruments.list.filterByHowDataGets')}
              className="h-[26px] w-32 text-label"
              value={search.connection ?? ''}
              onChange={(e) => setParam('connection')(e.target.value)}
            >
              <option value="">{t('library.instruments.list.any')}</option>
              {INTAKE_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.title}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1 text-label text-fg-muted">
            {t('library.instruments.list.calibration')}
            <Select
              aria-label={t('library.instruments.list.filterByCalibration')}
              className="h-[26px] w-32 text-label"
              value={search.calibration ?? ''}
              onChange={(e) => setParam('calibration')(e.target.value)}
            >
              <option value="">{t('library.instruments.list.any')}</option>
              <option value="ok">
                {t('library.instruments.list.current')}
              </option>
              <option value="soon">
                {t('library.instruments.list.dueInDays', {
                  calibrationDueSoonDays: CALIBRATION_DUE_SOON_DAYS,
                })}
              </option>
              <option value="overdue">
                {t('library.instruments.list.overdue')}
              </option>
            </Select>
          </label>
        </div>
      }
    />
  )
}

/** The table, its phone list, and what it says when there is nothing to show. */
export function InstrumentsTable({ list }: { list: InstrumentsListModel }) {
  const {
    query,
    visible,
    columns,
    view,
    rowSelection,
    onRowSelectionChange,
    openInstrument,
    sel,
    calFor,
    healthFor,
  } = list

  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {query.isPending ? (
        <RegistryGrid
          label={t('library.instruments.list.instruments')}
          rows={[]}
          columns={columns}
          getRowId={(i) => i.id}
          selectable={false}
          isLoading
        />
      ) : visible.length ? (
        <>
          <MobileList
            label={t('library.instruments.list.instruments')}
            items={visible.map((i) => {
              const c = calFor(i.id)
              const health = healthFor(i)

              return {
                key: i.id,
                id: i.displayId ?? i.id.slice(0, 8),
                title: i.name,
                // A phone has no table column for the registry state, so the row says
                // whether the instrument can be booked rather than leaving that to the
                // inspector or the Schedule page.
                sub: [
                  intakeMethodLabel(i.intakeMethod),
                  i.location ?? t('library.instruments.list.noLocation'),
                  i.retiredAt
                    ? t('library.instruments.list.retiredCantBeBooked')
                    : isOutOfService(i)
                      ? t('library.instruments.outOfService.listBlocked')
                      : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                selected: i.id === sel?.id,
                link: {
                  to: '/instruments/$instrumentId',
                  params: { instrumentId: i.id },
                  onClick: (event: React.MouseEvent) =>
                    openInstrument(i, event),
                },
                status:
                  c.state === 'overdue' ? (
                    <span className="text-danger-text">
                      {t('library.instruments.list.calibrationOverdue')}
                    </span>
                  ) : health.tone === 'bad' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Dot tone="bad" />
                      {health.label}
                    </span>
                  ) : health.tone === 'warn' ? (
                    <span className="text-warning-text">{health.label}</span>
                  ) : c.state === 'soon' ? (
                    <span className="text-warning-text">
                      {t('library.instruments.list.calibration2', {
                        label: c.label,
                      })}
                    </span>
                  ) : undefined,
              }
            })}
          />
          <RegistryGrid
            className="max-md:hidden"
            label={t('library.instruments.list.instruments')}
            view={view}
            rows={visible}
            columns={columns}
            getRowId={(i) => i.id}
            rowSelection={rowSelection}
            onRowSelectionChange={onRowSelectionChange}
            onRowClick={openInstrument}
            isLoading={query.isPending}
          />
        </>
      ) : (
        <InstrumentsEmpty list={list} />
      )}
    </div>
  )
}

/** Nothing registered, or nothing in this tab: say which, and offer a way on. */
function InstrumentsEmpty({ list }: { list: InstrumentsListModel }) {
  const { rows, search, tab, filtered, canManageInstruments } = list

  if (search.state === 'empty' || rows.length === 0) {
    return (
      <div className="px-4 md:px-6">
        <EmptyState
          icon="plug"
          title={t('library.instruments.list.noInstrumentsRegisteredYet')}
          description={t('library.instruments.list.registerAnInstrumentToBook')}
          action={
            canManageInstruments ? (
              <RegisterInstrument
                types={list.types}
                workspaceId={list.workspaceId}
                ownerId={list.ownerId}
              />
            ) : undefined
          }
        />
      </div>
    )
  }

  return (
    <div role="status" className="px-4 md:px-6">
      <EmptyState
        icon="search"
        title={
          search.q
            ? t('library.instruments.list.noInstrumentsMatch', {
                q: search.q,
              })
            : t('library.instruments.list.noInstrumentsIn', {
                toLowerCase: tabLabels[tab].toLowerCase(),
              })
        }
        description={
          filtered
            ? t('library.instruments.list.searchLooksAtIdName')
            : tab === 'retired'
              ? t('library.instruments.list.retiredInstrumentsStayHereWith')
              : t('library.instruments.list.nothingIsInThisList')
        }
        action={
          <Button
            nativeButton={false}
            render={<Link to="/instruments" search={{ tab: search.tab }} />}
          >
            {filtered
              ? t('library.instruments.list.clearSearchAndFilters')
              : t('library.instruments.list.showAllInstruments')}
          </Button>
        }
      />
    </div>
  )
}

/** "x of y …" for the tab in view, and the one row the inspector shows. */
export function InstrumentsFooter({ list }: { list: InstrumentsListModel }) {
  const { query, visible, counts, tab, sel } = list

  return (
    <ListFooter
      loading={query.isPending}
      right={sel ? '1 selected' : undefined}
    >
      {visible.length} of {counts[tab]} {tabCountLabels[tab]}
    </ListFooter>
  )
}
