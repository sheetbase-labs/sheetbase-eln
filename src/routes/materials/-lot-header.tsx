/**
 * The lot page's header parts for the shared record page: the facts it shows
 * beside the ID, the one line about its state, the main action and the rest
 * under ⋯. The page owns the dialogs these actions open.
 */
import type { ComponentProps } from 'react'

import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import {
  HazardPictograms,
  SignalWordBadge,
} from '#/components/materials/material-safety'
import type { MaterialListRow } from '#/components/materials/materials-data'
import type { RecordFact } from '#/components/record-page/record-page'
import { RecordStateLine } from '#/components/record-page/record-state-line'
import { t } from '#/copy'

import { stockOfTotal } from '../-materials-page'

/** Lot, stock, location and supplier: what a person checks before using it. */
export function lotFacts(row: MaterialListRow): RecordFact[] {
  return [
    { label: t('library.materials.lot.lot'), value: row.lot, mono: true },
    { label: t('library.materials.lot.stock'), value: stockOfTotal(row) },
    { label: t('library.materials.lot.location'), value: row.location },
    { label: t('library.materials.lot.supplier'), value: row.supplier },
  ]
}

export function LotMarks({
  signalWord,
  pictograms,
}: {
  signalWord: ComponentProps<typeof SignalWordBadge>['word'] | null | undefined
  pictograms: ComponentProps<typeof HazardPictograms>['pictograms']
}) {
  return (
    <>
      {signalWord ? <SignalWordBadge word={signalWord} /> : null}
      <HazardPictograms pictograms={pictograms} size={22} />
    </>
  )
}

/**
 * The lot's one state line: quarantine first, then expiry (with whether a
 * replacement is lined up), then low stock. A lot in good standing has none.
 */
export function LotStateLine({
  row,
  quarantined,
  replacement,
  holdBusy,
  onRestore,
  onRegisterReplacement,
}: {
  row: MaterialListRow
  quarantined: boolean
  replacement: { targetIdentifier: string } | null
  holdBusy: boolean
  onRestore: () => void
  onRegisterReplacement: () => void
}) {
  if (quarantined) {
    return (
      <RecordStateLine
        tone="bad"
        action={
          <Button size="sm" disabled={holdBusy} onClick={onRestore}>
            {t('common.actions.restore')}
          </Button>
        }
      >
        {t('library.materials.lot.quarantinedLine')}
      </RecordStateLine>
    )
  }

  if (row.expiryNote) {
    return (
      <RecordStateLine
        tone={row.attention?.tone === 'bad' ? 'bad' : 'warn'}
        action={
          replacement ? null : (
            <Button size="sm" onClick={onRegisterReplacement}>
              {t('library.materials.lot.registerReplacement')}
            </Button>
          )
        }
      >
        {replacement
          ? t('library.materials.lot.replacementRegistered', {
              note: row.expiryNote,
              identifier: replacement.targetIdentifier,
            })
          : t('library.materials.lot.noReplacementYet', {
              note: row.expiryNote,
            })}
      </RecordStateLine>
    )
  }

  // What is left after quarantine and expiry is low stock.
  if (row.attention) {
    return (
      <RecordStateLine
        tone="warn"
        action={
          replacement ? null : (
            <Button size="sm" onClick={onRegisterReplacement}>
              {t('library.materials.lot.registerReplacement')}
            </Button>
          )
        }
      >
        {t('library.materials.lot.lowStockLine', { stock: row.stock })}
      </RecordStateLine>
    )
  }

  return null
}

/** Use is the lot's main action; it is shut while the lot can't be used. */
export function LotActions({
  recordId,
  usable,
  onUse,
}: {
  recordId: string
  usable: boolean
  onUse: () => void
}) {
  return (
    <>
      <FavouriteToggle kind="record" objectId={recordId} />
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
    </>
  )
}

export function LotMoreItems({
  usable,
  quarantined,
  holdBusy,
  onRegisterReplacement,
  onMakeSolution,
  onPrintLabel,
  onRestore,
  onQuarantine,
}: {
  usable: boolean
  quarantined: boolean
  holdBusy: boolean
  onRegisterReplacement: () => void
  onMakeSolution: () => void
  onPrintLabel: () => void
  onRestore: () => void
  onQuarantine: () => void
}) {
  return (
    <>
      <DropdownMenuItem icon="plus" onClick={onRegisterReplacement}>
        {t('library.materials.lot.registerReplacementLot')}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!usable} onClick={onMakeSolution}>
        {t('library.materials.solution.useInSolution')}
      </DropdownMenuItem>
      <DropdownMenuItem icon="download" onClick={onPrintLabel}>
        {t('safety.label.print')}
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
    </>
  )
}
