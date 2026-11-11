/**
 * The three sections of the reagent lot page: what the lot is, every movement
 * of it, and where it has been used. Each one is handed the reads the page has
 * already made, so switching tabs costs no request.
 */
import { Link } from '@tanstack/react-router'

import { stockOfTotal } from '../-materials-page'
import { DescriptionList } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { MaterialSafetySection } from '#/components/materials/material-safety'
import { MOVEMENT_LABELS } from '#/lib/reagent-data'
import type {
  CertificateFile,
  ReagentMovement,
  ReagentUsageLink,
} from '#/lib/reagent-data'
import type { MadeFromIngredient, PreparedWithLot } from '#/lib/solution-prep'
import type { MaterialListRow } from '#/components/materials/materials-data'
import { t } from '#/copy'

import {
  amount,
  dateTimeLabel,
  dayLabel,
  movementChange,
} from './-lot-page-model'

const madeFromColumns: RegistryColumn<MadeFromIngredient>[] = [
  {
    id: 'material',
    header: t('library.materials.solution.materialColumn'),
    accessorFn: (item) => item.title,
    cell: ({ row }) => (
      <>
        {row.original.recordId ? (
          <Link
            to="/materials/$lotId"
            params={{ lotId: row.original.recordId }}
            className="hover:underline"
          >
            {row.original.title}
          </Link>
        ) : (
          row.original.title
        )}
        <span className="mono ml-2 text-fg-muted">
          {row.original.identifier}
        </span>
      </>
    ),
  },
  {
    id: 'lot',
    header: t('library.materials.solution.lotColumn'),
    accessorFn: (item) => item.lot ?? '',
    cell: ({ row }) => row.original.lot ?? '—',
  },
  {
    id: 'amount',
    header: t('library.materials.solution.amountColumn'),
    accessorFn: (item) => item.quantity,
    cell: ({ row }) => (
      <span className="mono">
        {amount(row.original.quantity, row.original.unit)}
      </span>
    ),
    ...rightAligned<MadeFromIngredient>(),
  },
  {
    id: 'expiry',
    header: t('library.materials.solution.expiryColumn'),
    accessorFn: (item) => item.expiry ?? '',
    cell: ({ row }) => dayLabel(row.original.expiry),
  },
]

const preparedWithColumns: RegistryColumn<PreparedWithLot>[] = [
  {
    id: 'solution',
    header: t('library.materials.solution.solutionColumn'),
    accessorFn: (item) => item.title,
    cell: ({ row }) => (
      <>
        <Link
          to="/materials/$lotId"
          params={{ lotId: row.original.productId }}
          className="hover:underline"
        >
          {row.original.title}
        </Link>
        <span className="mono ml-2 text-fg-muted">
          {row.original.identifier}
        </span>
      </>
    ),
  },
  {
    id: 'amount',
    header: t('library.materials.solution.amountColumn'),
    accessorFn: (item) => item.quantity,
    cell: ({ row }) => (
      <span className="mono">
        {amount(row.original.quantity, row.original.unit)}
      </span>
    ),
    ...rightAligned<PreparedWithLot>(),
  },
  {
    id: 'when',
    header: t('library.materials.solution.whenColumn'),
    accessorFn: (item) => item.createdAt,
    cell: ({ row }) => dayLabel(row.original.createdAt),
  },
]

/** The lot's certificate file as a link, or the code it was recorded under. */
export function LotCertificateLabel({
  certificate,
  fallback,
}: {
  certificate: CertificateFile | null | undefined
  fallback: string | null
}) {
  if (!certificate) return <>{fallback ?? '—'}</>

  return (
    <Link
      to="/records/$recordId"
      params={{ recordId: certificate.fileRecordId }}
      className="hover:underline"
    >
      {certificate.displayName}
    </Link>
  )
}

export function LotDetailsTab({
  lotId,
  row,
  title,
  expiry,
  projectId,
  canEdit,
  madeFrom,
  certificate,
  certificateNote,
}: {
  lotId: string
  row: MaterialListRow
  title: string
  expiry: string | null
  projectId: string | null
  canEdit: boolean
  madeFrom: readonly MadeFromIngredient[] | null | undefined
  certificate: CertificateFile | null | undefined
  certificateNote: string | null
}) {
  return (
    <>
      <section aria-label={t('library.materials.lot.lot')} className="max-w-xl">
        <h2 className="mb-1.5 font-sans text-label font-semibold">
          {t('library.materials.lot.lot')}
        </h2>
        <DescriptionList
          labelWidth={96}
          items={[
            [
              'Supplier',
              row.catalogNo
                ? `${row.supplier} · cat. ${row.catalogNo}`
                : row.supplier,
            ],
            ['Stock', stockOfTotal(row)],
            ['Location', row.location],
            ['Expiry', dayLabel(expiry)],
            ['Received', dayLabel(row.received)],
          ]}
        />
      </section>
      {madeFrom && madeFrom.length > 0 ? (
        <section aria-label={t('library.materials.solution.madeFrom')}>
          <h2 className="mb-1.5 font-sans text-label font-semibold">
            {t('library.materials.solution.madeFrom')}
          </h2>
          <TableBox className="max-w-3xl shrink-0">
            <RegistryGrid
              label={t('library.materials.solution.madeFrom')}
              rows={[...madeFrom]}
              columns={madeFromColumns}
              getRowId={(item) => item.id}
              selectable={false}
            />
          </TableBox>
        </section>
      ) : null}
      <section
        aria-label={t('library.materials.lot.certificate')}
        className="max-w-xl"
      >
        <h2 className="mb-1.5 font-sans text-label font-semibold">
          {t('library.materials.lot.certificateOfAnalysis')}
        </h2>
        {certificate ? (
          <span className="text-label">
            <LotCertificateLabel certificate={certificate} fallback={null} />
          </span>
        ) : (
          <p className="text-label text-fg-muted">
            {certificateNote ??
              t('library.materials.lot.noCertificateIsAttachedTo')}
          </p>
        )}
      </section>
      <MaterialSafetySection
        recordId={lotId}
        name={title}
        projectId={projectId}
        canEdit={canEdit}
      />
    </>
  )
}

export function LotLedgerTab({
  ledger,
  isLoading,
  userLabel,
}: {
  ledger: readonly ReagentMovement[] | undefined
  isLoading: boolean
  userLabel: (userId: string) => string
}) {
  return (
    <section aria-label={t('library.materials.lot.ledger')}>
      {ledger && ledger.length > 0 ? (
        <table className="w-full border-collapse text-label">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="py-1 pr-3 font-medium">
                {t('library.materials.lot.when')}
              </th>
              <th className="py-1 pr-3 font-medium">
                {t('library.materials.lot.movement')}
              </th>
              <th className="py-1 pr-3 text-right font-medium">
                {t('library.materials.lot.change')}
              </th>
              <th className="py-1 pr-3 text-right font-medium">
                {t('library.materials.lot.balance')}
              </th>
              <th className="py-1 pr-3 font-medium">
                {t('library.materials.lot.by')}
              </th>
              <th className="py-1 font-medium">
                {t('library.materials.lot.reason')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="py-1 pr-3">{dateTimeLabel(m.createdAt)}</td>
                <td className="py-1 pr-3">{MOVEMENT_LABELS[m.operation]}</td>
                <td className="mono py-1 pr-3 text-right">
                  {movementChange(m)}
                </td>
                <td className="mono py-1 pr-3 text-right">
                  {amount(m.resultingQuantity, m.unit)}
                </td>
                <td className="py-1 pr-3">
                  {m.actorUserId ? userLabel(m.actorUserId) : '—'}
                </td>
                <td className="py-1">{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-label text-fg-muted">
          {isLoading
            ? t('library.materials.lot.loadingLedger')
            : t('library.materials.lot.noMovementsYet')}
        </p>
      )}
    </section>
  )
}

export function LotUsedTab({
  preparedWith,
  usage,
  usageLoading,
}: {
  preparedWith: readonly PreparedWithLot[] | null | undefined
  usage: readonly ReagentUsageLink[] | undefined
  usageLoading: boolean
}) {
  return (
    <>
      {preparedWith && preparedWith.length > 0 ? (
        <section aria-label={t('library.materials.solution.preparedWith')}>
          <h2 className="mb-1.5 font-sans text-label font-semibold">
            {t('library.materials.solution.preparedWith')}
          </h2>
          <TableBox className="max-w-3xl shrink-0">
            <RegistryGrid
              label={t('library.materials.solution.preparedWith')}
              rows={[...preparedWith]}
              columns={preparedWithColumns}
              getRowId={(item) => item.id}
              selectable={false}
            />
          </TableBox>
        </section>
      ) : null}
      <section aria-label={t('library.materials.lot.usedIn')}>
        {usage?.length ? (
          <ul className="flex flex-col gap-1">
            {usage.map((link) => (
              <li key={link.id} className="text-label">
                <Link
                  to="/records/$recordId"
                  params={{
                    recordId: link.sourceRecordId ?? link.sourceIdentifier,
                  }}
                  className="mono hover:underline"
                >
                  {link.sourceIdentifier}
                </Link>
                {link.quantity != null
                  ? ` · ${amount(link.quantity, link.unit)}`
                  : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-label text-fg-muted">
            {usageLoading
              ? t('common.states.loading')
              : t('library.materials.lot.noExperimentHasUsedThis')}
          </p>
        )}
      </section>
    </>
  )
}
