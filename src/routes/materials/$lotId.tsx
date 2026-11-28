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
import { RecordPage } from '#/components/record-page/record-page'
import { LotActions, LotMarks, LotMoreItems, LotStateLine } from './-lot-header'
import { LotTabPanel } from './-lot-tabs'
import { LotSidePanel } from './-lot-inspector'
import {
  QuarantineLotDialog,
  ReplacementLotDialog,
  UseLotDialog,
} from './-lot-dialogs'
import {
  isLotUsable,
  lotFacts,
  lotLabelSource,
  lotTabSchema,
} from './-lot-page-model'
import type { LotTab } from './-lot-page-model'
import { useRecordResults } from '#/lib/record-results'
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
  const results = useRecordResults(reagent?.id)

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
    <RecordPage
      recordId={reagent.id}
      trail={[
        {
          label: t('library.materials.lot.materials'),
          link: { to: '/materials' },
        },
        { label: reagent.identifier, mono: true },
      ]}
      title={reagent.title}
      identifier={reagent.identifier}
      status={row.status}
      facts={lotFacts(row)}
      marks={
        <LotMarks
          signalWord={safety.data?.signalWord}
          pictograms={safety.data?.pictograms ?? []}
        />
      }
      actions={
        <LotActions
          recordId={reagent.id}
          usable={usable}
          onUse={() => setUseOpen(true)}
        />
      }
      moreLabel={t('library.materials.lot.moreLotActions')}
      more={
        <LotMoreItems
          usable={usable}
          quarantined={quarantined}
          holdBusy={hold.isPending}
          onRegisterReplacement={() => setReplacementOpen(true)}
          onMakeSolution={() => setSolutionOpen(true)}
          onPrintLabel={() => window.print()}
          onRestore={() => hold.mutate({ operation: 'restore' })}
          onQuarantine={() => setQuarantineOpen(true)}
        />
      }
      stateLine={
        <LotStateLine
          row={row}
          quarantined={quarantined}
          replacement={replacementLink.data ?? null}
          holdBusy={hold.isPending}
          onRestore={() => hold.mutate({ operation: 'restore' })}
          onRegisterReplacement={() => setReplacementOpen(true)}
        />
      }
      tabs={{
        mode: 'state',
        label: t('library.materials.lot.lotSections'),
        value: tab,
        onValueChange: (next) => setTab(lotTabSchema.parse(next)),
        items: [
          { key: 'details', label: t('library.materials.lot.details') },
          {
            key: 'ledger',
            label: t('library.materials.lot.ledger'),
            count: ledger.data ? ledgerCount : undefined,
          },
          {
            key: 'used',
            label: t('library.materials.lot.usedIn'),
            count: usage.data ? usedCount : undefined,
          },
          {
            key: 'results',
            label: t('features.recordResults.tab'),
            count: results.data?.total,
          },
          {
            key: 'history',
            label: t('notebook.recordPage.history'),
            end: true,
          },
        ],
      }}
      sideLabel={t('library.materials.lot.lotContext')}
      side={
        <LotSidePanel
          recordId={reagent.id}
          row={row}
          identifier={reagent.identifier}
          title={reagent.title}
          labelChoice={labelChoice}
          labelSource={labelSource}
          hazards={safety.data?.pictograms}
          replacement={replacementLink.data ?? null}
          onShowHistory={() => setTab('history')}
        />
      }
      overlays={
        <>
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
        </>
      }
    >
      <LotTabPanel
        tab={tab}
        lotId={lotId}
        recordId={reagent.id}
        row={row}
        title={reagent.title}
        projectId={reagent.projectId}
        canEdit={canEdit}
        madeFrom={madeFrom.data}
        certificate={certificate.data}
        ledger={ledger}
        userLabel={userLabel}
        preparedWith={preparedWith.data}
        usage={usage}
      />
    </RecordPage>
  )
}
