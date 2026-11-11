import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { PageHeader } from '#/components/ui/layout'
import { useMaterialSafety } from '#/components/materials/material-safety'
import { toMaterialListRow } from '#/components/materials/materials-data'
import { MakeSolutionDialog } from '#/components/materials/make-solution-dialog'
import { useLabelTemplateChoice } from '#/components/samples/use-label-template-choice'
import { SampleLabelPrint } from '#/components/samples/sample-label-print'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useHasCapability } from '#/lib/use-capability'
import { solutionQueryKeys } from '#/lib/solution-prep'
import { t } from '#/copy'
import { LotHeader } from './-lot-header'
import { LotDetailsTab, LotLedgerTab, LotUsedTab } from './-lot-tabs'
import { LotInspector } from './-lot-inspector'
import {
  QuarantineLotDialog,
  ReplacementLotDialog,
  UseLotDialog,
} from './-lot-dialogs'
import { isLotUsable, lotLabelSource } from './-lot-page-model'
import type { LotTab } from './-lot-page-model'
import { useLotPageData } from './-lot-page-data'

/**
 * Roadmap Phase 6 (stock): the reagent lot page. A lot has a page of its own
 * with the Use action, the full movement ledger and its certificate, rather
 * than only the registry's inspector.
 */
export const Route = createFileRoute('/materials/$lotId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    await resolveIdentifierParam({
      entity: 'record',
      ref: params.lotId,
      href: location.href,
    })

    return { context }
  },
  component: LotPage,
})

function LotPage() {
  const { lotId } = Route.useParams()
  const queryClient = useQueryClient()
  const [useOpen, setUseOpen] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const [solutionOpen, setSolutionOpen] = useState(false)
  const [quarantineOpen, setQuarantineOpen] = useState(false)
  const [quarantineReason, setQuarantineReason] = useState('')
  const [tab, setTab] = useState<LotTab>('details')

  const {
    lot,
    reagent,
    ledger,
    usage,
    certificate,
    replacementLink,
    madeFrom,
    preparedWith,
    userLabel,
    refresh,
    useStock,
    hold,
    replacement,
  } = useLotPageData(lotId, {
    onStockUsed: () => setUseOpen(false),
    onLotHeld: () => {
      setQuarantineOpen(false)
      setQuarantineReason('')
    },
    onReplacementRegistered: () => setReplacementOpen(false),
  })

  const canEdit = useHasCapability('record.create')
  const safety = useMaterialSafety(lotId)
  const labelChoice = useLabelTemplateChoice('material')

  if (!reagent) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.materials.lot.materials'),
              link: { to: '/materials' },
            },
          ]}
          title={
            lot.isLoading
              ? t('library.materials.lot.loadingLot')
              : t('library.materials.lot.lotNotFound')
          }
        />
        <RecordUnavailable
          query={lot}
          what={t('settings.uiKit.recordUnavailable.lot')}
          back={{
            to: '/materials',
            label: t('settings.uiKit.recordUnavailable.backToMaterials'),
          }}
        />
      </div>
    )
  }

  const row = toMaterialListRow(reagent)
  const quarantined = reagent.status === 'quarantined'
  const usable = isLotUsable(reagent.status, reagent.quantity, row.tabs)

  const usedCount = (usage.data?.length ?? 0) + (preparedWith.data?.length ?? 0)
  const ledgerCount = ledger.data?.length ?? 0

  const labelSource = lotLabelSource(
    reagent.lot,
    reagent.storage,
    reagent.expiry,
    safety.data?.signalWord
      ? t(`safety.signalWord.${safety.data.signalWord}`)
      : null,
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <LotHeader
        recordId={reagent.id}
        identifier={reagent.identifier}
        title={reagent.title}
        row={row}
        signalWord={safety.data?.signalWord}
        pictograms={safety.data?.pictograms ?? []}
        quarantined={quarantined}
        usable={usable}
        holdBusy={hold.isPending}
        tab={tab}
        ledgerCount={ledger.data ? ledgerCount : undefined}
        usedCount={usage.data ? usedCount : undefined}
        onTabChange={setTab}
        onRegisterReplacement={() => setReplacementOpen(true)}
        onUse={() => setUseOpen(true)}
        onMakeSolution={() => setSolutionOpen(true)}
        onRestore={() => hold.mutate({ operation: 'restore' })}
        onQuarantine={() => setQuarantineOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto px-6 py-5">
          {tab === 'details' ? (
            <LotDetailsTab
              lotId={lotId}
              row={row}
              title={reagent.title}
              expiry={reagent.expiry}
              projectId={reagent.projectId}
              canEdit={canEdit}
              madeFrom={madeFrom.data}
              certificate={certificate.data}
              certificateNote={row.certificate}
            />
          ) : null}
          {tab === 'ledger' ? (
            <LotLedgerTab
              ledger={ledger.data}
              isLoading={ledger.isLoading}
              userLabel={userLabel}
            />
          ) : null}
          {tab === 'used' ? (
            <LotUsedTab
              preparedWith={preparedWith.data}
              usage={usage.data}
              usageLoading={usage.isLoading}
            />
          ) : null}
        </div>
        <LotInspector
          row={row}
          identifier={reagent.identifier}
          title={reagent.title}
          certificate={certificate.data}
          labelChoice={labelChoice}
          labelSource={labelSource}
          hazards={safety.data?.pictograms}
          replacement={replacementLink.data ?? null}
          ledger={ledger.data}
        />
      </div>

      <SampleLabelPrint
        record={{ identifier: reagent.identifier, title: reagent.title }}
        template={labelChoice.chosen}
        source={labelSource}
        hazards={safety.data?.pictograms}
      />

      <ReplacementLotDialog
        open={replacementOpen}
        onOpenChange={setReplacementOpen}
        identifier={reagent.identifier}
        title={reagent.title}
        unit={reagent.unit}
        busy={replacement.isPending}
        onSubmit={(input) => replacement.mutate(input)}
      />

      <MakeSolutionDialog
        open={solutionOpen}
        onOpenChange={setSolutionOpen}
        initialLot={reagent}
        onMade={() => {
          refresh()
          void queryClient.invalidateQueries({
            queryKey: solutionQueryKeys.preparedWith(lotId),
          })
        }}
      />

      <QuarantineLotDialog
        open={quarantineOpen}
        onOpenChange={setQuarantineOpen}
        identifier={reagent.identifier}
        title={reagent.title}
        reason={quarantineReason}
        onReasonChange={setQuarantineReason}
        busy={hold.isPending}
        onConfirm={() =>
          hold.mutate({ operation: 'quarantine', reason: quarantineReason })
        }
      />

      <UseLotDialog
        open={useOpen}
        onOpenChange={setUseOpen}
        identifier={reagent.identifier}
        title={reagent.title}
        stock={row.stock}
        available={reagent.quantity}
        unit={reagent.unit}
        busy={useStock.isPending}
        onSubmit={(input) => useStock.mutate(input)}
      />
    </div>
  )
}
