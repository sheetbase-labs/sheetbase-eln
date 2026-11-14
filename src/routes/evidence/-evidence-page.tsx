import { t } from '#/copy'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  PageHeader,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { Notice } from '#/components/ui/alert'
import { Status } from '#/components/ui/status'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Textarea } from '#/components/inventory/list'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
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
import { fetchSignaturesForRecord, signatureQueryKeys } from '#/lib/signatures'

const Route = getRouteApi('/evidence/$revisionId')

type EvidenceRevision = NonNullable<
  Awaited<ReturnType<typeof fetchRevisionRow>>
>

/** One block of a frozen revision, as the grid shows it. */
type FrozenBlock = EvidenceRevision['block_snapshot'][number]

/** One line of a block's content: its text, or the keys it holds. */
function textSummary(payload: FrozenBlock['payload']): string {
  const text = payload.text ?? payload.title ?? payload.value
  const decoded = z.string().safeParse(text)

  if (decoded.success && decoded.data.trim()) return decoded.data.trim()
  const keys = Object.keys(payload)

  return keys.length ? keys.slice(0, 4).join(', ') : '—'
}

const frozenBlockColumns: RegistryColumn<FrozenBlock>[] = [
  {
    id: 'order',
    header: t('notebook.evidencePage.order'),
    meta: {
      ...rightAligned<FrozenBlock>().meta,
      cellClassName: 'text-right num',
    },
    cell: ({ row }) => row.original.order,
  },
  {
    id: 'block',
    header: t('notebook.evidencePage.block'),
    cell: ({ row }) => row.original.type,
  },
  {
    id: 'content',
    header: t('notebook.evidencePage.content'),
    meta: { cellClassName: 'max-w-[520px] text-fg-muted' },
    cell: ({ row }) => (
      <span className="block truncate">
        {textSummary(row.original.payload)}
      </span>
    ),
  },
]

/** What this revision is, how it stands, and what can be done with it. */
function EvidenceHeader({
  identifier,
  title,
  signed,
  digest,
  createdAt,
  recordId,
  revisionId,
  exporting,
  onExport,
  onAmend,
}: {
  identifier: string
  title: string
  signed: boolean
  digest: string
  createdAt: string
  recordId: string
  revisionId: string
  exporting: boolean
  onExport: (path: string, fallbackName: string) => void
  onAmend: () => void
}): React.ReactElement {
  return (
    <PageHeader
      trail={[
        { label: t('notebook.evidencePage.label'), link: { to: '/inbox' } },
        { label: identifier, mono: true },
      ]}
      title={title}
      meta={
        <>
          <span className="text-fg">
            <Status tone={signed ? 'ok' : 'review'}>
              {signed
                ? t('notebook.evidencePage.signedFrozenRevision')
                : t('notebook.evidencePage.submittedNotSigned')}
            </Status>
          </span>
          <span>
            {t('notebook.evidencePage.savedCreatedAt', {
              created_at: createdAt.slice(0, 10),
            })}
          </span>
          <span className="mono max-lg:hidden">hash {digest.slice(0, 12)}</span>
        </>
      }
      actions={
        <>
          <Button
            nativeButton={false}
            render={
              <Link to="/records/$recordId/notebook" params={{ recordId }} />
            }
          >
            {t('notebook.evidencePage.openLiveRecord')}
          </Button>
          {/* MOB-02.4: creating an amendment unlocks the record for a new
              draft revision to be reviewed and signed; that is a desktop
              job, so below the phone breakpoint the page says so instead of
              offering the action. */}
          {signed ? (
            <Button
              disabled={!recordId}
              onClick={onAmend}
              className="max-md:hidden"
            >
              {t('notebook.evidencePage.createAmendment')}
            </Button>
          ) : null}
          <Button
            disabled={exporting}
            onClick={() =>
              onExport(
                `/api/export/revision/${revisionId}/pdf`,
                `evidence-${revisionId}.pdf`,
              )
            }
          >
            {t('notebook.evidencePage.exportPdf')}
          </Button>
          <Button
            variant="primary"
            disabled={exporting}
            onClick={() =>
              onExport(
                `/api/export/revision/${revisionId}/package`,
                `evidence-${revisionId}.zip`,
              )
            }
          >
            {exporting
              ? t('notebook.evidencePage.exporting')
              : t('notebook.evidencePage.exportEvidencePackage')}
          </Button>
        </>
      }
    />
  )
}

/** The frozen blocks, as the desktop table and the phone list. */
function FrozenRevisionContent({
  blocks,
  signed,
  drifted,
  digest,
  algorithm,
}: {
  blocks: FrozenBlock[]
  signed: boolean
  drifted: boolean
  digest: string
  algorithm: string
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
      <Notice
        icon="lock"
        title={t('notebook.evidencePage.youAreLookingAtTitle')}
      >
        {signed
          ? t('notebook.evidencePage.thisRevisionReadsExactly')
          : t('notebook.evidencePage.thisRevisionReadsExactlyUnsigned')}
      </Notice>
      {drifted ? (
        <Notice tone="warn">
          {t('notebook.evidencePage.theLiveRecordHas')}
        </Notice>
      ) : null}
      {/* MOB-02.4: on a phone the integrity facts the desktop keeps in the
              inspector are stated in the column, next to the frozen content
              they vouch for. */}
      <div className="flex flex-col gap-1 md:hidden">
        <Status tone="ok">
          {signed
            ? t('notebook.evidencePage.hashVerifiedWhenSigned')
            : t('notebook.evidencePage.sealedWhenSubmitted')}
        </Status>
        <Muted className="break-all">
          {algorithm} · {digest}
        </Muted>
      </div>
      <TableBox className="max-md:hidden">
        <RegistryGrid
          label={t('notebook.evidencePage.frozenRevisionContentLabel')}
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
          aria-label={t('notebook.evidencePage.frozenRevisionContentLabel')}
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
        <Muted>{t('notebook.evidencePage.thisRevisionHasNo')}</Muted>
      ) : null}
      <p className="m-0 text-label text-fg-muted md:hidden">
        {t('notebook.evidencePage.creatingAnAmendmentNeeds')}
      </p>
    </div>
  )
}

/** The integrity, signature and amendment facts folded into the inspector. */
function EvidenceInspectorPanel({
  recordId,
  revisionId,
  signed,
  digest,
  algorithm,
  structureVersion,
  metadataVersion,
}: {
  recordId: string
  revisionId: string
  signed: boolean
  digest: string
  algorithm: string
  structureVersion: number
  metadataVersion: number
}): React.ReactElement {
  return (
    <Inspector
      aria-label={t('notebook.evidencePage.ariaLabel')}
      className="w-[360px]"
    >
      {/* The phone column above states the hash, so the folded-away inspector
            does not repeat it (heading included) there. */}
      <div className="max-md:hidden">
        <InspectorSection title={t('notebook.evidencePage.integrityTitle')}>
          <Status tone="ok">
            {signed
              ? t('notebook.evidencePage.verifiedWhenSigned')
              : t('notebook.evidencePage.sealedWhenSubmitted')}
          </Status>
          <Muted className="mt-1 break-all">
            {algorithm} · {digest}
          </Muted>
        </InspectorSection>
      </div>
      <EvidenceSignatures
        recordId={recordId}
        revisionId={revisionId}
        structureVersion={structureVersion}
      />
      <EvidenceDrift revisionId={revisionId} signed={signed} />
      <InspectorSection title={t('notebook.evidencePage.revisionTitle')}>
        <Muted>
          {t('notebook.evidencePage.structureVStructureVersion', {
            structure_version: structureVersion,
            metadata_version: metadataVersion,
          })}
        </Muted>
        <Muted className="mt-1 break-all">{revisionId}</Muted>
      </InspectorSection>
      <InspectorSection title={t('notebook.evidencePage.amendmentsTitle')}>
        <Muted>
          {signed
            ? t('notebook.evidencePage.aSignedRevisionIs')
            : t('notebook.evidencePage.aSubmittedRevisionIs')}
        </Muted>
      </InspectorSection>
    </Inspector>
  )
}

/** The amendment dialog: a reason, then the new draft opens. */
function AmendmentDialog({
  open,
  onOpenChange,
  note,
  onNoteChange,
  creating,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  note: string
  onNoteChange: (note: string) => void
  creating: boolean
  onCreate: () => void
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('notebook.evidencePage.createAmendment')}
          description={t(
            'notebook.evidencePage.theFrozenRevisionStaysDescription',
          )}
        />
        <DialogBody>
          <label className="flex flex-col gap-1 text-label">
            <span className="font-medium text-fg">
              {t('notebook.evidencePage.reasonForAmendment')}
            </span>
            <Textarea
              aria-label={t('notebook.evidencePage.reasonForAmendment')}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder={t('notebook.evidencePage.placeholder')}
            />
          </label>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button variant="primary" disabled={creating} onClick={onCreate}>
            {creating
              ? t('notebook.evidencePage.creating')
              : t('notebook.evidencePage.createAmendment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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

  // Whether anyone has signed this revision decides what the page may call
  // it: submitted evidence is frozen, but only a signature makes it signed.
  const signatureRows = useQuery({
    queryKey: signatureQueryKeys.forRecord(recordId),
    queryFn: () => fetchSignaturesForRecord(notebookDataClient, recordId),
    enabled: Boolean(recordId),
  })

  const signed =
    record?.lockedByRevisionId === revisionId ||
    (signatureRows.data ?? []).some((row) => row.revision_id === revisionId)

  const navigate = useNavigate()
  const [amendOpen, setAmendOpen] = useState(false)
  const [note, setNote] = useState('')
  const [exporting, setExporting] = useState(false)

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- An amendment opens a new draft on another route; this page unmounts and the destination reads its own queries.
  const amend = useMutation({
    mutationFn: () =>
      createAmendment(sign002DataClient, {
        recordId,
        note: note.trim() || undefined,
      }),
    onSuccess: (result) => {
      setAmendOpen(false)
      setNote('')
      toast(t('notebook.evidencePage.amendmentStarted'), {
        description: t('notebook.evidencePage.description'),
      })
      void navigate({
        to: '/records/$recordId/notebook',
        params: { recordId: result.recordId },
      })
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A refused amendment is a caught throw, so it reaches this callback untyped; Error supplies its message.
    onError: (error: unknown) => {
      toast.error(t('notebook.evidencePage.couldNotAmend'), {
        description:
          error instanceof Error
            ? error.message
            : t('notebook.evidencePage.theDatabaseRefusedItDescription'),
      })
    },
  })

  const title = useMemo(() => {
    const fromMeta = z.string().safeParse(revision?.metadata_snapshot.title)

    return fromMeta.success && fromMeta.data.trim()
      ? fromMeta.data
      : (record?.title ?? t('notebook.evidencePage.submittedEvidence'))
  }, [revision, record])

  const metaIdentifier = z
    .string()
    .safeParse(revision?.metadata_snapshot.identifier)

  const identifier = metaIdentifier.success
    ? metaIdentifier.data
    : (record?.identifier ?? revisionId)

  if (revisionQuery.isLoading) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            { label: t('notebook.evidencePage.label'), link: { to: '/inbox' } },
          ]}
          title={t('notebook.evidencePage.title')}
        />
      </div>
    )
  }

  if (!revision) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            { label: t('notebook.evidencePage.label'), link: { to: '/inbox' } },
          ]}
          title={t('notebook.evidencePage.evidenceNotFoundTitle')}
        />
        <div className="px-4 py-4 md:px-6">
          <EmptyState
            icon="protocol"
            title={t('notebook.evidencePage.noRevisionHasThisTitle')}
            description={t(
              'notebook.evidencePage.evidenceIsAFrozenDescription',
            )}
            action={
              <Button nativeButton={false} render={<Link to="/inbox" />}>
                {t('notebook.evidencePage.backToInbox')}
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
            ? t('notebook.evidencePage.thisRevisionHasNothing')
            : t('notebook.evidencePage.theServerCouldNot'),
        )
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition')

      const filename =
        disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName

      downloadTextFile(filename, blob)
    } catch (error) {
      toast.error(t('notebook.evidencePage.couldNotExportThe'), {
        description:
          error instanceof Error
            ? error.message
            : t('notebook.evidencePage.theRequestFailedDescription'),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <EvidenceHeader
          identifier={identifier}
          title={title}
          signed={signed}
          digest={digest}
          createdAt={revision.created_at}
          recordId={recordId}
          revisionId={revision.id}
          exporting={exporting}
          onExport={(path, fallbackName) => void exportFile(path, fallbackName)}
          onAmend={() => setAmendOpen(true)}
        />
        <FrozenRevisionContent
          blocks={blocks}
          signed={signed}
          drifted={drifted}
          digest={digest}
          algorithm={revision.integrity_algorithm ?? 'sha256'}
        />
      </div>
      <EvidenceInspectorPanel
        recordId={recordId}
        revisionId={revision.id}
        signed={signed}
        digest={digest}
        algorithm={revision.integrity_algorithm ?? 'sha256'}
        structureVersion={revision.structure_version}
        metadataVersion={revision.metadata_version}
      />
      <AmendmentDialog
        open={amendOpen}
        onOpenChange={setAmendOpen}
        note={note}
        onNoteChange={setNote}
        creating={amend.isPending}
        onCreate={() => amend.mutate()}
      />
    </div>
  )
}
