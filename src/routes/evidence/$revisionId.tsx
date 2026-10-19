import { useMemo, useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  PageHeader,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  EvidenceDrift,
  EvidenceSignatures,
} from '#/components/review/evidence-inspector'
import { fetchRecord, notebookDataClient } from '#/lib/notebook-data'
import { downloadTextFile } from '#/lib/download'
import {
  fetchRevisionRow,
  reviewWorkspaceDataClient,
} from '#/lib/review-workspace'
import { createAmendment, sign002DataClient } from '#/lib/sign-002'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): submitted evidence. The frozen revision reads
 * exactly as it was signed and never changes; when the live record has moved on,
 * that is stated and the way forward is an amendment, never an edit.
 *
 * MOB-02.4: below the phone breakpoint the wide order/block/content table and
 * the inspector's integrity facts become one readable column (the blocks as
 * wrapping rows, the hash stated inline), while the amendment stays a desktop
 * action and the page says so. */
export const Route = createFileRoute('/evidence/$revisionId')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: EvidencePage,
})

function textSummary(payload: Record<string, unknown>): string {
  const text = payload.text ?? payload.title ?? payload.value
  if (typeof text === 'string' && text.trim()) return text.trim()
  const keys = Object.keys(payload)
  return keys.length ? keys.slice(0, 4).join(', ') : '—'
}

/** The frozen blocks as the shared grid's rows; the table is read-only, so it
 * takes no selection column. */
interface FrozenBlock {
  id: string
  order: number
  type: string
  payload: Record<string, unknown>
}

const frozenBlockColumns: RegistryColumn<FrozenBlock>[] = [
  {
    id: 'order',
    header: 'Order',
    meta: {
      ...rightAligned<FrozenBlock>().meta,
      cellClassName: 'text-right num',
    },
    cell: ({ row }) => row.original.order,
  },
  {
    id: 'block',
    header: 'Block',
    cell: ({ row }) => row.original.type,
  },
  {
    id: 'content',
    header: 'Content',
    meta: { cellClassName: 'max-w-[520px] text-fg-muted' },
    cell: ({ row }) => (
      <span className="block truncate">
        {textSummary(row.original.payload)}
      </span>
    ),
  },
]

export function EvidencePage() {
  const { revisionId } = Route.useParams()
  const revisionQuery = useQuery({
    queryKey: ['ui-port', 'evidence', revisionId],
    queryFn: () => fetchRevisionRow(reviewWorkspaceDataClient, revisionId),
  })
  const revision = revisionQuery.data
  const recordId = revision?.record_id ?? ''
  const recordQuery = useQuery({
    queryKey: ['ui-port', 'evidence-record', recordId],
    queryFn: () => fetchRecord(notebookDataClient, recordId),
    enabled: Boolean(recordId),
  })
  const record = recordQuery.data
  const navigate = useNavigate()
  const [amendOpen, setAmendOpen] = useState(false)
  const [note, setNote] = useState('')
  const [exporting, setExporting] = useState(false)

  const amend = useMutation({
    mutationFn: () =>
      createAmendment(sign002DataClient, {
        recordId,
        note: note.trim() || undefined,
      }),
    onSuccess: (result) => {
      setAmendOpen(false)
      setNote('')
      toast('Amendment started', {
        description: 'The record is unlocked for a new draft revision.',
      })
      void navigate({
        to: '/records/$recordId/notebook',
        params: { recordId: result.recordId },
      })
    },
    onError: (error: unknown) => {
      toast('Could not amend', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    },
  })

  const title = useMemo(() => {
    const meta = revision?.metadata_snapshot ?? {}
    const fromMeta = meta.title
    return typeof fromMeta === 'string' && fromMeta.trim()
      ? fromMeta
      : (record?.title ?? 'Submitted evidence')
  }, [revision, record])

  const identifier =
    typeof revision?.metadata_snapshot.identifier === 'string'
      ? revision.metadata_snapshot.identifier
      : (record?.identifier ?? revisionId)

  if (revisionQuery.isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader trail={[{ label: 'Evidence' }]} title="Loading evidence…" />
      </div>
    )
  }
  if (!revision) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Evidence' }]}
          title="Evidence not found"
        />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="protocol"
            title="No revision has this id"
            description="Evidence is a frozen revision of a record; it may have been superseded or belong to another workspace."
            action={
              <Button nativeButton={false} render={<Link to="/inbox" />}>
                Back to inbox
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  const drifted =
    Boolean(revision.superseded_by_revision_id) ||
    (record?.lockedByRevisionId != null &&
      record.lockedByRevisionId !== revision.id)
  const blocks = [...revision.block_snapshot].sort((a, b) => a.order - b.order)
  const digest = revision.integrity_digest ?? '—'
  // The revision is fixed for this render; reading its id here keeps the
  // handler below working from a value, not from a narrowed query result.
  const packagePath = `/api/export/revision/${revision.id}/package`
  const packageFilename = `evidence-${revision.id}.zip`

  // The package endpoint answers 404 for a revision the caller cannot read and
  // 500 for a build failure. Fetch it here so a refusal is a message beside the
  // button instead of a raw error page replacing the evidence.
  async function exportFile(path: string, fallbackName: string) {
    setExporting(true)
    try {
      const response = await fetch(path)
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'This revision has nothing to export.'
            : 'The server could not build the export.',
        )
      }
      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition')
      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName
      downloadTextFile(filename, blob)
    } catch (error) {
      toast('Could not export the evidence', {
        description:
          error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          trail={[
            { label: 'Inbox', link: { to: '/inbox' } },
            { label: identifier, mono: true },
          ]}
          title={title}
          meta={
            <>
              <span className="text-fg">
                <Status tone="ok">Evidence · frozen revision</Status>
              </span>
              <span>Saved {revision.created_at.slice(0, 10)}</span>
              <span className="mono max-lg:hidden">
                hash {digest.slice(0, 12)}
              </span>
            </>
          }
          actions={
            <>
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/records/$recordId/notebook"
                    params={{ recordId }}
                  />
                }
              >
                Open live record
              </Button>
              {/* MOB-02.4: creating an amendment unlocks the record for a new
                  draft revision to be reviewed and signed; that is a desktop
                  job, so below the phone breakpoint the page says so instead of
                  offering the action. */}
              <Button
                disabled={!recordId}
                onClick={() => setAmendOpen(true)}
                className="max-md:hidden"
              >
                Create amendment
              </Button>
              <Button
                disabled={exporting}
                onClick={() =>
                  void exportFile(
                    `/api/export/revision/${revision.id}/pdf`,
                    `evidence-${revision.id}.pdf`,
                  )
                }
              >
                Export PDF
              </Button>
              <Button
                variant="primary"
                disabled={exporting}
                onClick={() => void exportFile(packagePath, packageFilename)}
              >
                {exporting ? 'Exporting…' : 'Export evidence package'}
              </Button>
            </>
          }
        />
        <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
          <Notice icon="lock" title="You are looking at submitted evidence.">
            This revision reads exactly as it was signed. It will never change.
          </Notice>
          {drifted ? (
            <Notice tone="warn">
              The live record has moved on since this revision was signed. The
              evidence above is unchanged; make an amendment — never an edit.
            </Notice>
          ) : null}
          {/* MOB-02.4: on a phone the integrity facts the desktop keeps in the
              inspector are stated in the column, next to the frozen content
              they vouch for. */}
          <div className="flex flex-col gap-1 md:hidden">
            <Status tone="ok">Hash verified when signed</Status>
            <Muted className="break-all">
              {revision.integrity_algorithm ?? 'sha256'} · {digest}
            </Muted>
          </div>
          <TableBox className="max-w-[900px] max-md:hidden">
            <RegistryGrid
              label="Frozen revision content"
              rows={blocks}
              columns={frozenBlockColumns}
              getRowId={(block) => block.id}
              selectable={false}
            />
          </TableBox>
          {/* MOB-02.4: the same frozen blocks as the desktop table, one
              readable column, with the content wrapping in full rather than
              truncated to a narrow third of a wide table. */}
          {blocks.length ? (
            <ul
              aria-label="Frozen revision content"
              className="m-0 list-none rounded-md border border-border px-4 md:hidden"
            >
              {blocks.map((b) => (
                <li
                  key={b.id}
                  className="flex min-h-14 flex-col justify-center gap-1 border-b border-border-subtle py-2.5 last:border-0"
                >
                  <span className="flex items-baseline gap-2 text-label">
                    <span className="num text-fg-muted">{b.order}</span>
                    <span className="font-medium text-fg">{b.type}</span>
                  </span>
                  <span className="text-body text-fg">
                    {textSummary(b.payload)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {blocks.length === 0 ? (
            <Muted>This revision has no blocks recorded.</Muted>
          ) : null}
          <p className="m-0 text-label text-fg-muted md:hidden">
            Creating an amendment needs a desktop: it unlocks the record for a
            new draft revision, which is reviewed and signed in its own right.
          </p>
        </div>
      </div>

      <Inspector aria-label="Evidence package" className="w-[360px]">
        {/* The phone column above states the hash, so the folded-away inspector
            does not repeat it (heading included) there. */}
        <div className="max-md:hidden">
          <InspectorSection title="Integrity">
            <Status tone="ok">Verified when signed</Status>
            <Muted className="mt-1 break-all">
              {revision.integrity_algorithm ?? 'sha256'} · {digest}
            </Muted>
          </InspectorSection>
        </div>
        <EvidenceSignatures
          recordId={recordId}
          revisionId={revision.id}
          structureVersion={revision.structure_version}
        />
        <EvidenceDrift revisionId={revision.id} />
        <InspectorSection title="Revision">
          <Muted>
            Structure v{revision.structure_version} · metadata v
            {revision.metadata_version}
          </Muted>
          <Muted className="mt-1 break-all">{revision.id}</Muted>
        </InspectorSection>
        <InspectorSection title="Amendments">
          <Muted>
            A signed revision is never edited. A correction is a new amendment
            revision, which is reviewed and signed in its own right.
          </Muted>
        </InspectorSection>
      </Inspector>

      <Dialog open={amendOpen} onOpenChange={setAmendOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title="Create amendment"
            description="The frozen revision stays as signed. An amendment starts a new draft revision of the record, which is reviewed and signed in its own right."
          />
          <DialogBody>
            <label className="flex flex-col gap-1 text-label">
              <span className="font-medium text-fg">Reason for amendment</span>
              <Textarea
                aria-label="Reason for amendment"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What is being corrected, and why"
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              disabled={amend.isPending}
              onClick={() => amend.mutate()}
            >
              {amend.isPending ? 'Creating…' : 'Create amendment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
