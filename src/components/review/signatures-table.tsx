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
  return `${ordered.slice(0, -1).join(', ')} and ${ordered[ordered.length - 1]}`
}

/**
 * States what the evidence binds to. When no revision version is known the
 * note stays truthful and names no version rather than inventing one.
 */
export function signatureBindingNote(versions: number[]): string {
  const lead =
    'Each signature was made with a password re-entry and is bound to'
  if (versions.length === 0) return `${lead} the frozen revision it attests.`
  const noun = versions.length === 1 ? 'version' : 'versions'
  return `${lead} ${noun} ${formatVersionList(versions)} of this record.`
}

export function SignaturesTable({
  signatures,
  isLoading = false,
  isError = false,
  revisionVersions = {},
}: SignaturesTableProps) {
  if (isError) {
    return (
      <section aria-label="Signatures" className="py-4">
        <p role="alert" className="m-0 text-label text-fg-muted">
          Signatures could not be loaded.
        </p>
      </section>
    )
  }

  if (isLoading) {
    return (
      <section aria-label="Signatures" className="py-4">
        <Muted>Loading signatures…</Muted>
      </section>
    )
  }

  const ordered = inChronologicalOrder(signatures)

  if (ordered.length === 0) {
    return (
      <section aria-label="Signatures" className="py-4">
        <EmptyState
          icon="edit"
          title="No signatures yet"
          description="Signatures appear here once a frozen revision of this record has been signed."
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
    <section aria-label="Signatures" className="flex flex-col gap-2 py-4">
      <TableBox>
        <Table aria-label="Signatures">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Meaning</TableHead>
              <TableHead>Signed</TableHead>
              <TableHead>Signature ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.map((signature) => (
              <TableRow key={signature.id}>
                <TableCell>
                  {signature.signer_name ??
                    'Name not recorded in historical evidence'}
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
                <TableCell className="mono text-fg-muted">
                  {signature.id}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableBox>
      <Muted>{signatureBindingNote(boundVersions)}</Muted>
    </section>
  )
}
