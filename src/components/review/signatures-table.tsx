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

import { AuditCheckLine } from '#/components/review/audit-check-line'
import { Badge } from '#/components/v3/ui/badge'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { SIGNATURE_MEANING_LABEL } from '#/lib/signatures'
import type { SignatureWire } from '#/lib/signatures'
import { t } from '#/copy'

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
}

/** Oldest-first, then by id — matches the canonical record query ordering. */
function inChronologicalOrder(signatures: SignatureWire[]): SignatureWire[] {
  return [...signatures].sort(
    (a, b) =>
      a.signed_at.localeCompare(b.signed_at) || a.id.localeCompare(b.id),
  )
}

function formatVersionList(versions: number[]): string {
  const ordered = [...versions].sort((a, b) => a - b)
  if (ordered.length <= 1) return String(ordered[0] ?? '')
  return t('projects.signatures.listAnd', {
    list: ordered.slice(0, -1).join(', '),
    last: ordered[ordered.length - 1],
  })
}

/**
 * States what the evidence binds to. When no revision version is known the
 * note stays truthful and names no version rather than inventing one.
 */
export function signatureBindingNote(versions: number[]): string {
  if (versions.length === 0) return t('projects.signatures.bindingNone')
  return versions.length === 1
    ? t('projects.signatures.bindingOne', {
        versions: formatVersionList(versions),
      })
    : t('projects.signatures.bindingMany', {
        versions: formatVersionList(versions),
      })
}

export function SignaturesTable({
  signatures,
  isLoading = false,
  isError = false,
  revisionVersions = {},
}: SignaturesTableProps) {
  if (isError) {
    return (
      <section aria-label={t('projects.signatures.title')} className="py-4">
        <p role="alert" className="m-0 text-label text-fg-muted">
          {t('projects.signatures.loadFailed')}
        </p>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section aria-label={t('projects.signatures.title')} className="py-4">
        <Muted>{t('projects.signatures.loading')}</Muted>
      </section>
    )
  }

  const ordered = inChronologicalOrder(signatures)

  if (ordered.length === 0) {
    return (
      <section aria-label={t('projects.signatures.title')} className="py-4">
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
        .filter((version): version is number => typeof version === 'number'),
    ),
  ]

  return (
    <section
      aria-label={t('projects.signatures.title')}
      className="flex flex-col gap-2 py-4"
    >
      <TableBox>
        <Table aria-label={t('projects.signatures.title')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('projects.signatures.columns.name')}</TableHead>
              <TableHead>{t('projects.signatures.columns.meaning')}</TableHead>
              <TableHead>{t('projects.signatures.columns.signed')}</TableHead>
              <TableHead>{t('projects.signatures.columns.id')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((signature) => (
              <TableRow key={signature.id}>
                <TableCell>
                  {signature.signer_name ?? t('projects.signatures.noName')}
                  {signature.auth_method === 'demo' ? (
                    <Badge
                      variant="kind"
                      className="ml-2"
                      title={t('projects.signatures.demoSignatureTooltip')}
                    >
                      {t('projects.signatures.demoSignature')}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  {SIGNATURE_MEANING_LABEL[signature.signature_meaning]}
                </TableCell>
                <TableCell>
                  <time dateTime={signature.signed_at}>
                    {formatNotebookDateTime(signature.signed_at, {
                      zone: true,
                    })}
                  </time>
                </TableCell>
                <TableCell className="mono max-w-[16rem] truncate text-fg-muted">
                  <span title={signature.id}>{signature.id}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <AuditCheckLine note={signatureBindingNote(boundVersions)} />
    </section>
  )
}
