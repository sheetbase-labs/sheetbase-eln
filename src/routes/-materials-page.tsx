/**
 * UI port (roadmap-4/ui-app3): the materials registry, wired to real material
 * records. Receive lot writes through record_reagent_movement.
 *
 * The screen itself is a composition: `-materials-page-model` owns the tab
 * names and the list derivation, `-materials-page-data` the reads and writes,
 * and `-materials-page-panels` / `-materials-page-dialogs` the rendering.
 */
import { useEffect } from 'react'

import { Outlet, getRouteApi, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { reagentPath } from '#/lib/navigation'
import { useRowFocus } from '#/components/inventory/registry-grid'
import { ReagentOrdersPanel } from '#/components/materials/reagent-orders'
import { SpendReportPanel } from '#/components/materials/spend-report'
import { materialListQueryKeys } from '#/components/materials/materials-data'
import type { MaterialListRow } from '#/components/materials/materials-data'

import { isMaterialPanelTab, materialsTab } from './-materials-page-model'
import {
  useMaterialsDialogs,
  useMaterialsListModel,
  useMaterialsReads,
  useMaterialLotActions,
  useMaterialLotReads,
} from './-materials-page-data'
import { useMaterialColumns } from './-materials-page-columns'
import {
  MaterialInspector,
  MaterialsBody,
  MaterialsHeader,
} from './-materials-page-panels'
import { MaterialsDialogs } from './-materials-page-dialogs'

export { ReplacementForm } from './-materials-page-dialogs'

export { stockOfTotal } from './-materials-page-model'

export type { MaterialTab } from './-materials-page-model'

const Route = getRouteApi('/materials')

/** The registry, or the lot page nested under it. */
export function MaterialsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/materials',
  })

  return isIndex ? <MaterialsList /> : <Outlet />
}

function MaterialsList() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const reads = useMaterialsReads(search.tab)

  const tab = materialsTab({
    requested: search.tab,
    canPlaceOrders: reads.canPlaceOrders,
  })

  const panelTab = isMaterialPanelTab(tab)
  const dialogs = useMaterialsDialogs()
  const model = useMaterialsListModel({ reads, tab, search })
  const columns = useMaterialColumns(reads.safetyByLot.data)
  const rowFocus = useRowFocus(model.sel?.uuid ?? null, model.setSelected)

  const openMaterial = useOpenRow<MaterialListRow>(
    navigate,
    (row) => reagentPath(row.uuid),
    (row) => row.name,
  )

  const lotReads = useMaterialLotReads(model.sel)

  // The shell's New menu arrives with `?new=true`: open the dialog, then drop
  // the flag so a reload does not open it again.
  const { setRegisterOpen } = dialogs

  useEffect(() => {
    if (!search.new) return
    setRegisterOpen(true)
    void navigate({
      to: '/materials',
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [search.new, navigate, setRegisterOpen])

  // A link naming a lot on another tab moves to the tab that holds it, so the
  // first row of the wrong list is never what the page selects.
  const { linkedTab } = model

  useEffect(() => {
    if (!linkedTab) return
    void navigate({
      to: '/materials',
      search: (s) => ({
        ...s,
        tab: linkedTab === 'instock' ? undefined : linkedTab,
        q: undefined,
      }),
      replace: true,
    })
  }, [linkedTab, navigate])

  const actions = useMaterialLotActions({
    sel: model.sel,
    queryClient,
    closeQuarantine: dialogs.closeQuarantine,
    closeReplacement: () => dialogs.setReplacementOpen(false),
    closeRegister: () => dialogs.setRegisterOpen(false),
    closeReceive: () => dialogs.setReceiveOpen(false),
    onRegistered: (created) => {
      void navigate({
        to: '/materials',
        search: { selected: created.id },
        replace: true,
      })
    },
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <MaterialsHeader
          canWrite={reads.canWrite}
          canPlaceOrders={reads.canPlaceOrders}
          sel={model.sel}
          page={reads.page}
          orders={reads.orders}
          archivedCount={reads.archivedCount}
          counts={model.counts}
          searchQuery={search.q}
          tab={tab}
          onRegister={() => dialogs.setRegisterOpen(true)}
          onReceive={() => dialogs.setReceiveOpen(true)}
          onSolution={() => dialogs.setSolutionOpen(true)}
        />
        {tab === 'orders' ? (
          <ReagentOrdersPanel
            canPlace={reads.canPlaceOrders}
            canWrite={reads.canWrite}
          />
        ) : null}
        {tab === 'spend' ? <SpendReportPanel /> : null}
        <MaterialsBody
          tab={tab}
          panelTab={panelTab}
          searchQuery={search.q}
          counts={model.counts}
          visible={model.visible}
          sel={model.sel}
          view={reads.view}
          bulk={reads.bulk}
          columns={columns}
          rowFocus={rowFocus}
          page={reads.page}
          hasProjectAccess={reads.hasProjectAccess}
          canWrite={reads.canWrite}
          onRegister={() => dialogs.setRegisterOpen(true)}
          onSearch={(next) =>
            void navigate({
              to: '/materials',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
          onBulkChanged={() => {
            void queryClient.invalidateQueries({
              queryKey: materialListQueryKeys.page,
            })
          }}
          onOpenMaterial={openMaterial}
        />
      </div>

      {model.sel ? (
        <MaterialInspector
          sel={model.sel}
          safetyPictograms={
            reads.safetyByLot.data?.get(model.sel.uuid)?.pictograms
          }
          openOrder={model.openOrder}
          canWrite={reads.canWrite}
          certificate={lotReads.certificate.data}
          replacementLink={lotReads.replacementLink.data}
          usage={lotReads.usage.data ?? []}
          restoring={actions.restore.isPending}
          quarantining={actions.quarantine.isPending}
          onRegisterReplacement={() => dialogs.setReplacementOpen(true)}
          onRequestReorder={() => dialogs.setReorderOpen(true)}
          onRestore={() => actions.restore.mutate()}
          onQuarantine={() => dialogs.setQuarantineOpen(true)}
        />
      ) : null}

      <MaterialsDialogs
        sel={model.sel}
        projects={reads.projects.data ?? new Map()}
        reorderOpen={dialogs.reorderOpen}
        onReorderOpenChange={dialogs.setReorderOpen}
        receiveOpen={dialogs.receiveOpen}
        onReceiveOpenChange={dialogs.setReceiveOpen}
        receiveBusy={actions.receive.isPending}
        onReceive={(input) => actions.receive.mutate(input)}
        solutionOpen={dialogs.solutionOpen}
        onSolutionOpenChange={dialogs.setSolutionOpen}
        registerOpen={dialogs.registerOpen}
        onRegisterOpenChange={dialogs.setRegisterOpen}
        registerBusy={actions.register.isPending}
        onRegister={(input) => actions.register.mutate(input)}
        replacementOpen={dialogs.replacementOpen}
        onReplacementOpenChange={dialogs.setReplacementOpen}
        replacementBusy={actions.replacement.isPending}
        onReplacement={(input) => actions.replacement.mutate(input)}
        quarantineOpen={dialogs.quarantineOpen}
        onQuarantineOpenChange={dialogs.setQuarantineOpen}
        quarantineReason={dialogs.quarantineReason}
        onQuarantineReasonChange={dialogs.setQuarantineReason}
        quarantineBusy={actions.quarantine.isPending}
        onQuarantine={() => actions.quarantine.mutate(dialogs.quarantineReason)}
      />
    </div>
  )
}
