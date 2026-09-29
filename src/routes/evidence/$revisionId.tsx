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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { fetchRecord, notebookDataClient } from '#/lib/notebook-data'
import {
  fetchRevisionRow,
  reviewWorkspaceDataClient,
} from '#/lib/review-workspace'
import { createAmendment, sign002DataClient } from '#/lib/sign-002'

/** UI port (roadmap-4/ui-app3): submitted evidence. The frozen revision reads
 * exactly as it was signed and never changes; when the live record has moved on,
 * that is stated and the way forward is an amendment, never an edit. */
export const Route = createFileRoute('/evidence/$revisionId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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

function EvidencePage() {
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
        <PageHeader crumbs="Evidence" title="Loading evidence…" />
      </div>
    )
  }
  if (!revision) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader crumbs="Evidence" title="Evidence not found" />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="protocol"
            title="No revision has this id"
            body="Evidence is a frozen revision of a record; it may have been superseded or belong to another workspace."
          >
            <Button nativeButton={false} render={<Link to="/inbox" />}>
              Back to inbox
            </Button>
          </EmptyState>
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

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <PageHeader
          crumbs={
            <>
              <Link to="/inbox" className="text-link">
                Inbox
              </Link>{' '}
              / <span className="mono">{identifier}</span>
            </>
          }
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
              <Button disabled={!recordId} onClick={() => setAmendOpen(true)}>
                Create amendment
              </Button>
              <Button
                variant="primary"
                nativeButton={false}
                render={
                  <a href={`/api/export/revision/${revision.id}/package`} />
                }
              >
                Export evidence package
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
          <TableBox className="max-w-[900px]">
            <Table aria-label="Frozen revision content">
              <TableHeader>
                <TableRow>
                  <TableHead align="right">Order</TableHead>
                  <TableHead>Block</TableHead>
                  <TableHead>Content</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell align="right" className="num">
                      {b.order}
                    </TableCell>
                    <TableCell>{b.type}</TableCell>
                    <TableCell className="max-w-[520px] truncate text-fg-muted">
                      {textSummary(b.payload)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          {blocks.length === 0 ? (
            <Muted>This revision has no blocks recorded.</Muted>
          ) : null}
        </div>
      </div>

      <Inspector aria-label="Evidence package" className="w-[320px]">
        <InspectorSection title="Integrity">
          <Status tone="ok">Verified when signed</Status>
          <Muted className="mt-1 break-all">
            {revision.integrity_algorithm ?? 'sha256'} · {digest}
          </Muted>
        </InspectorSection>
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
