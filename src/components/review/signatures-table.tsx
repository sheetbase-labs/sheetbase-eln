/**
 * REV-02.3 — Signatures table for a signed record.
 *
 * Renders the immutable signatures bound to a record's revisions as the
 * `NbSigned` canvas shows them: name, meaning, signed time and signature ID,
 * with a binding note naming the revision version each signature attests.
 *
 * The table never reports a load failure as success and never renders an empty
 * table shell in place of an honest empty state; both the failure and the empty
 * case are stated in words.
 */

import { z } from 'zod'

import { AuditCheckLine } from '#/components/review/audit-check-line'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import { Muted } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { SIGNATURE_MEANING_LABEL } from '#/lib/signatures'
import type { SignatureWire } from '#/lib/signatures'
import { t } from '#/copy'
import { signatureBindingNote } from './signature-binding'

const revisionVersion = z.custom<number>(
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Approved native version gate: keep NaN/Infinity, reject inherited prototype functions, and do not reinterpret frozen version metadata.
  (value) => typeof value === 'number',
)

export interface SignaturesTableProps {
  signatures: SignatureWire[]
  /** A load is in flight: the table must not claim there are no signatures. */
  isLoading?: boolean
  /** The load failed: never presented as an empty or successful table. */
  isError?: boolean
  /**
   * Revision id → structure version. Used only to name the version in the
   * binding note; a signature whose revision is absent is never given a
   * guessed version.
   */
  revisionVersions?: Readonly<Record<string, number>>
  /** A heading for the section; the info icon sits beside it. */
  heading?: string
}

/** Oldest-first, then by id — matches the canonical record query ordering. */
function inChronologicalOrder(signatures: SignatureWire[]): SignatureWire[] {
  return [...signatures].sort(
    (a, b) =>
      a.signed_at.localeCompare(b.signed_at) || a.id.localeCompare(b.id),
  )
}

export function SignaturesTable({
  signatures,
  isLoading = false,
  isError = false,
  revisionVersions = {},
  heading,
}: SignaturesTableProps) {
  const title = heading ? (
    <h2 className="m-0 font-display text-base font-semibold text-fg">
      {heading}
    </h2>
  ) : null

  if (isError) {
    return (
      <section aria-label={t('projects.signatures.title')} className="py-4">
        {title}
        <p role="alert" className="m-0 text-label text-fg-muted">
          {t('projects.signatures.loadFailed')}
        </p>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section aria-label={t('projects.signatures.title')} className="py-4">
        {title}
        <Muted>{t('projects.signatures.loading')}</Muted>
      </section>
    )
  }

  const ordered = inChronologicalOrder(signatures)

  if (ordered.length === 0) {
    return (
      <section aria-label={t('projects.signatures.title')} className="py-4">
        {title}
        <EmptyState
          icon="edit"
          title={t('projects.signatures.empty.title')}
          description={t('projects.signatures.empty.body')}
        />
      </section>
    )
  }

  const boundVersions = [
    ...new Set(
      ordered
        .map((signature) => revisionVersions[signature.revision_id])
        .filter((version) => revisionVersion.safeParse(version).success),
    ),
  ]

  const columns: RegistryColumn<(typeof ordered)[number]>[] = [
    {
      id: 'name',
      header: t('projects.signatures.columns.name'),
      accessorFn: (signature) => signature.signer_name ?? '',
      cell: ({ row }) => (
        <>
          {row.original.signer_name ?? t('projects.signatures.noName')}
          {row.original.auth_method === 'demo' ? (
            <Badge
              variant="kind"
              className="ml-2"
              title={t('projects.signatures.demoSignatureTooltip')}
            >
              {t('projects.signatures.demoSignature')}
            </Badge>
          ) : null}
        </>
      ),
    },
    {
      id: 'meaning',
      header: t('projects.signatures.columns.meaning'),
      accessorFn: (signature) =>
        SIGNATURE_MEANING_LABEL[signature.signature_meaning],
    },
    {
      id: 'signed',
      header: t('projects.signatures.columns.signed'),
      accessorFn: (signature) => signature.signed_at,
      cell: ({ row }) => (
        <time dateTime={row.original.signed_at}>
          {formatNotebookDateTime(row.original.signed_at, { zone: true })}
        </time>
      ),
    },
    {
      id: 'id',
      header: t('projects.signatures.columns.id'),
      accessorFn: (signature) => signature.id,
      cell: ({ row }) => (
        <span
          className="mono block max-w-[16rem] truncate text-fg-muted"
          title={row.original.id}
        >
          {row.original.id}
        </span>
      ),
    },
  ]

  return (
    <section
      aria-label={t('projects.signatures.title')}
      className="flex flex-col gap-2 py-4"
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {title}
        <AuditCheckLine note={signatureBindingNote(boundVersions)} />
      </div>
      <TableBox>
        <RegistryGrid
          label={t('projects.signatures.title')}
          rows={ordered}
          columns={columns}
          getRowId={(signature) => signature.id}
          selectable={false}
        />
      </TableBox>
    </section>
  )
}
