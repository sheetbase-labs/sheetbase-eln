/**
 * The lot page's header: who the lot is, its state at a glance, the actions a
 * person takes (replacement, use, solution, quarantine) and the sections the
 * page offers. The page owns the dialogs these actions open.
 */
import type { ComponentProps } from 'react'

import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import { Tabs } from '#/components/ui/tabs'
import { PageHeader } from '#/components/ui/layout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import {
  HazardPictograms,
  SignalWordBadge,
} from '#/components/materials/material-safety'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { t } from '#/copy'

import { lotTabSchema } from './-lot-page-model'
import type { LotTab } from './-lot-page-model'

export function LotHeader({
  recordId,
  identifier,
  title,
  row,
  signalWord,
  pictograms,
  quarantined,
  usable,
  holdBusy,
  tab,
  ledgerCount,
  usedCount,
  onTabChange,
  onRegisterReplacement,
  onUse,
  onMakeSolution,
  onRestore,
  onQuarantine,
}: {
  recordId: string
  identifier: string
  title: string
  row: MaterialListRow
  signalWord: ComponentProps<typeof SignalWordBadge>['word'] | null | undefined
  pictograms: ComponentProps<typeof HazardPictograms>['pictograms']
  quarantined: boolean
  usable: boolean
  holdBusy: boolean
  tab: LotTab
  ledgerCount: number | undefined
  usedCount: number | undefined
  onTabChange: (tab: LotTab) => void
  onRegisterReplacement: () => void
  onUse: () => void
  onMakeSolution: () => void
  onRestore: () => void
  onQuarantine: () => void
}) {
  return (
    <PageHeader
      trail={[
        {
          label: t('library.materials.lot.materials'),
          link: { to: '/materials' },
        },
        { label: identifier, mono: true },
      ]}
      title={title}
      meta={
        <>
          <span>lot {row.lot}</span>
          <Status tone={row.status.tone}>
            {row.expiryNote ?? row.status.label}
          </Status>
          {signalWord ? <SignalWordBadge word={signalWord} /> : null}
          <HazardPictograms pictograms={pictograms} size={22} />
        </>
      }
      actions={
        <>
          <FavouriteToggle kind="record" objectId={recordId} />
          <Button variant="secondary" onClick={onRegisterReplacement}>
            {t('library.materials.lot.registerReplacementLot')}
          </Button>
          <Button
            variant="primary"
            disabled={!usable}
            title={
              usable
                ? undefined
                : t('library.materials.lot.aQuarantinedExpiredOrEmpty')
            }
            onClick={onUse}
          >
            {t('library.materials.lot.use')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  aria-label={t('library.materials.lot.moreLotActions')}
                  icon="more"
                />
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!usable} onClick={onMakeSolution}>
                {t('library.materials.solution.useInSolution')}
              </DropdownMenuItem>
              {quarantined ? (
                <DropdownMenuItem disabled={holdBusy} onClick={onRestore}>
                  {t('common.actions.restore')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem danger onClick={onQuarantine}>
                  {t('library.materials.lot.quarantine')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      tabs={
        <Tabs
          mode="state"
          label={t('library.materials.lot.lotSections')}
          value={tab}
          onValueChange={(next) => onTabChange(lotTabSchema.parse(next))}
          items={[
            { key: 'details', label: t('library.materials.lot.details') },
            {
              key: 'ledger',
              label: t('library.materials.lot.ledger'),
              count: ledgerCount,
            },
            {
              key: 'used',
              label: t('library.materials.lot.usedIn'),
              count: usedCount,
            },
          ]}
        />
      }
    />
  )
}
