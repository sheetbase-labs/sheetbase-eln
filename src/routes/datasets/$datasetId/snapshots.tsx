import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { toast } from '#/components/v3/ui/sonner'
import { stickyCell, stickyHead } from '#/components/v3/inventory/list'
import {
  countSnapshotCitations,
  describeKeepError,
  describeRetentionPolicy,
  describeSnapshotCitations,
  describeSnapshotError,
  describeSnapshotKeeping,
  describeSnapshotSource,
  describeSnapshotTombstone,
  isSnapshotPrunable,
  isSnapshotTombstone,
  mostUrgentPruneWarning,
} from '#/components/v3/datasets/snapshot-data'
import type { SnapshotVersion } from '#/components/v3/datasets/snapshot-data'
import { hasCapability } from '#/lib/capability'
import { keepDatasetVersion } from '#/lib/dataset-explorer-data'
import { snapshotDataset } from '#/lib/dataset-product'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'
import { datasetVersionsQueryKey, useDatasetVersions } from '../$datasetId'

/** UI port (roadmap-4/ui-app3): the dataset Snapshots tab, wired to
 * dataset_version_list. DSET-03.1: retention, producer, hash and cited-by are
 * read from the model rather than hardcoded. DSET-03.3 adds the manual
 * "Create snapshot" action, the complete inspector and a link to compare the
 * selected snapshot against another. DSET-04.3 adds the prune warning with a
 * reason-bearing "Keep", and the tombstone state for a snapshot whose rows the
 * retention job removed. */
export const Route = createFileRoute('/datasets/$datasetId/snapshots')({
  component: Snapshots,
})

const selectClass =
  'h-[30px] min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-body text-fg max-md:h-10'

function Snapshots() {
  const { datasetId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const versions = useDatasetVersions(datasetId)
  const rows = (versions.data ?? []) as unknown as SnapshotVersion[]
  const [selected, setSelected] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [keepTarget, setKeepTarget] = useState<SnapshotVersion | null>(null)
  const current = rows.find((v) => v.id === selected) ?? rows.at(0)
  const index = current ? rows.indexOf(current) : -1
  const previous = index >= 0 ? rows[index + 1] : undefined
  const keeping = describeSnapshotKeeping(current)
  const tombstone = current ? isSnapshotTombstone(current) : false
  const pruneWarning = mostUrgentPruneWarning(rows)
  const citations = countSnapshotCitations(current?.citedBy)
  const citationLines = describeSnapshotCitations(current?.citedBy)
  const citedCount =
    citations.signedRevisions + citations.pipelineRuns + citations.analyses

  const canWrite = hasCapability(context.workspace?.role, 'record.create')

  // The manual snapshot RPC is optimistically concurrent-checked, so the
  // action needs the Dataset's current revision. Read it here rather than
  // trusting a cached list row.
  const datasetQuery = useQuery({
    queryKey: ['ui-port', 'dataset-revision', datasetId],
    queryFn: async () => {
      const found = await notebookDataClient.list<{
        id: string
        revision: number | string
        lifecycle: string
      }>(
        'datasets',
        `?id=eq.${encodeURIComponent(datasetId)}&select=id,revision,lifecycle`,
      )
      return found.at(0) ?? null
    },
  })
  const revision = datasetQuery.data ? Number(datasetQuery.data.revision) : null
  const canSnapshot =
    canWrite && revision !== null && datasetQuery.data?.lifecycle === 'active'
  const snapshotDisabledReason = !canWrite
    ? 'You have read access to this dataset, so snapshots cannot be created.'
    : datasetQuery.isLoading
      ? 'Checking the dataset’s current revision…'
      : datasetQuery.data?.lifecycle !== 'active'
        ? 'Archived datasets cannot be snapshotted.'
        : null

  const create = useMutation({
    mutationFn: (label: string) =>
      snapshotDataset(notebookDataClient, {
        datasetId,
        expectedRevision: revision as number,
        label,
      }),
    onSuccess: (created) => {
      setDialogOpen(false)
      setSelected(created.id)
      void queryClient.invalidateQueries({
        queryKey: datasetVersionsQueryKey(datasetId),
      })
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'dataset-revision', datasetId],
      })
      toast(`Snapshot ${created.label} saved`)
    },
    onError: (cause) =>
      toast('Could not save the snapshot', {
        description: describeSnapshotError(cause),
      }),
  })

  const keep = useMutation({
    mutationFn: (input: { version: SnapshotVersion; reason: string }) =>
      keepDatasetVersion(notebookDataClient, input.version.id, input.reason),
    onSuccess: (_result, input) => {
      setKeepTarget(null)
      void queryClient.invalidateQueries({
        queryKey: datasetVersionsQueryKey(datasetId),
      })
      toast(`Snapshot ${input.version.label} kept`, {
        description:
          'Its rows will not be removed by retention while the keep is in force.',
      })
    },
    onError: (cause) =>
      toast('Could not keep the snapshot', {
        description: describeKeepError(cause),
      }),
  })

  const others = rows.filter((v) => v.id !== current?.id)
  const compareTarget =
    compareWith && others.some((v) => v.id === compareWith)
      ? compareWith
      : (previous?.id ?? others.at(0)?.id ?? null)

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
        {pruneWarning ? (
          <Notice
            tone="warn"
            title={pruneWarning.title}
            action={
              canWrite ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const target = rows.find(
                      (v) => v.id === pruneWarning.versionId,
                    )
                    if (target) setKeepTarget(target)
                  }}
                >
                  Keep {pruneWarning.label}
                </Button>
              ) : undefined
            }
          >
            {pruneWarning.detail}
          </Notice>
        ) : null}
        <Notice icon="lock">
          A snapshot never changes. Records, analyses and pipeline runs cite the
          snapshot they used, so later imports can’t alter what was reviewed.
        </Notice>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Muted className="max-w-[52ch]">
            Imports and pipelines save snapshots automatically; you can also
            snapshot before an edit.
          </Muted>
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            disabled={!canSnapshot}
            title={snapshotDisabledReason ?? undefined}
            onClick={() => setDialogOpen(true)}
          >
            Create snapshot
          </Button>
        </div>
        {rows.length ? (
          <TableBox>
            <Table className="max-lg:min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead className={stickyHead}>Snapshot</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead align="right">Rows</TableHead>
                  <TableHead>Source revision</TableHead>
                  <TableHead>Retention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((v) => {
                  const view = describeSnapshotKeeping(v)
                  const removed = isSnapshotTombstone(v)
                  return (
                    <TableRow
                      key={v.id}
                      selected={v.id === current?.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(v.id)}
                    >
                      <TableCell
                        className={cn(
                          stickyCell,
                          v.id === current?.id && 'font-semibold',
                        )}
                      >
                        <span className="mono">{v.label}</span>
                      </TableCell>
                      <TableCell>
                        {v.createdAt.slice(0, 16).replace('T', ' ')}
                      </TableCell>
                      <TableCell align="right">
                        {removed ? (
                          <span className="text-fg-muted">Removed</span>
                        ) : (
                          v.rowCount
                        )}
                      </TableCell>
                      <TableCell className="num">
                        {v.sourceDatasetRevision}
                      </TableCell>
                      <TableCell>
                        {view ? (
                          <Status tone={view.tone}>{view.label}</Status>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <Muted>
            {versions.isLoading
              ? 'Loading snapshots…'
              : 'No snapshots yet. Snapshot the dataset to freeze its rows as evidence.'}
          </Muted>
        )}
        {!canWrite ? (
          <Notice tone="info" icon={false}>
            You have read access to this dataset, so snapshots cannot be created
            or kept. Ask a workspace writer.
          </Notice>
        ) : null}
      </div>

      {current ? (
        <Inspector className="w-[320px]">
          <InspectorSection title={`Snapshot ${current.label}`}>
            <DescriptionList
              labelWidth={96}
              items={[
                ['Saved', current.createdAt.slice(0, 16).replace('T', ' ')],
                ['Rows', tombstone ? 'Removed' : String(current.rowCount)],
                ['Source revision', String(current.sourceDatasetRevision)],
                [
                  'Made by',
                  current.createdByName ??
                    current.createdByUserId ??
                    current.createdByCredentialId ??
                    '—',
                ],
                ['Source', describeSnapshotSource(current.source)],
                ...(previous
                  ? ([['Previous', previous.label]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
                ...(current.rowsRemovedAt
                  ? ([['Rows removed', current.rowsRemovedAt.slice(0, 10)]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
              ]}
            />
          </InspectorSection>
          <InspectorSection title="Cited by">
            <div className="flex flex-col gap-1.5">
              {citedCount === 0 ? (
                <Muted>
                  Not cited by any signed record, analysis or pipeline run.
                </Muted>
              ) : (
                <>
                  <Muted>
                    {citations.signedRevisions} signed ·{' '}
                    {citations.pipelineRuns} runs · {citations.analyses}{' '}
                    analyses
                  </Muted>
                  {citationLines.map((line) => (
                    <span key={line} className="text-label text-fg-muted">
                      {line}
                    </span>
                  ))}
                </>
              )}
            </div>
          </InspectorSection>
          <InspectorSection title="Content hash">
            {tombstone ? (
              <Muted>
                Not shown after removal. The snapshot’s identity and history are
                kept, but the hash was derived from the rows that are now gone.
              </Muted>
            ) : (
              <span className="mono break-all text-[11px] leading-[16px]">
                {current.contentHash}
              </span>
            )}
          </InspectorSection>
          <InspectorSection title={tombstone ? 'What’s left' : 'Keeping'}>
            {keeping ? (
              <div className="flex flex-col gap-2">
                <Status tone={keeping.tone}>{keeping.label}</Status>
                <Muted>{keeping.detail}</Muted>
                {tombstone ? (
                  <>
                    <Muted>
                      Rule: {describeSnapshotTombstone(current).rule}
                    </Muted>
                    <Muted>{describeSnapshotTombstone(current).why}</Muted>
                  </>
                ) : (
                  <Muted>{describeRetentionPolicy(current.retention)}</Muted>
                )}
                {canWrite &&
                !tombstone &&
                isSnapshotPrunable(current.retention) ? (
                  <Button size="sm" onClick={() => setKeepTarget(current)}>
                    Keep {current.label}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </InspectorSection>
          <InspectorSection title="Compare">
            {tombstone ? (
              <Muted>
                The rows were removed, so there is nothing left to compare. The
                snapshot’s ID and history above identify exactly what was
                frozen.
              </Muted>
            ) : others.length && compareTarget ? (
              <div className="flex flex-col gap-2">
                <label className="sr-only" htmlFor="compare-with">
                  Compare with
                </label>
                <select
                  id="compare-with"
                  className={selectClass}
                  value={compareTarget}
                  onChange={(e) => setCompareWith(e.target.value)}
                >
                  {others.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} · {v.createdAt.slice(0, 10)}
                    </option>
                  ))}
                </select>
                <Link
                  to="/datasets/$datasetId/compare"
                  params={{ datasetId }}
                  search={{ from: current.id, to: compareTarget }}
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'justify-center',
                  )}
                >
                  Compare snapshots
                </Link>
              </div>
            ) : (
              <Muted>Save another snapshot to compare changes.</Muted>
            )}
          </InspectorSection>
        </Inspector>
      ) : null}

      <CreateSnapshotDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultLabel={`${context.user.name} · saved by hand`}
        busy={create.isPending}
        onSubmit={(label) => create.mutate(label)}
      />

      <KeepSnapshotDialog
        key={keepTarget?.id ?? 'none'}
        snapshot={keepTarget}
        onOpenChange={(open) => {
          if (!open) setKeepTarget(null)
        }}
        busy={keep.isPending}
        onSubmit={(reason) => {
          if (keepTarget) keep.mutate({ version: keepTarget, reason })
        }}
      />
    </>
  )
}

interface CreateSnapshotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultLabel: string
  busy?: boolean
  onSubmit: (label: string) => void
}

/**
 * "Save a snapshot now" dialog. A label is required so the snapshot list and
 * comparison stay readable; the value is trimmed by the product helper before
 * it reaches the RPC.
 */
function CreateSnapshotDialog({
  open,
  onOpenChange,
  defaultLabel,
  busy = false,
  onSubmit,
}: CreateSnapshotDialogProps) {
  const formId = 'create-snapshot'
  const [label, setLabel] = useState(defaultLabel)
  const [touched, setTouched] = useState(false)
  const trimmed = label.trim()
  const invalid = trimmed.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLabel(defaultLabel)
          setTouched(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title="Create snapshot"
          description="Freeze the dataset’s current rows and flags as evidence."
        />
        <DialogBody>
          <Notice tone="info" icon={false}>
            A snapshot never changes. Later imports and edits do not alter it,
            and anything that cites it keeps citing exactly these rows.
          </Notice>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!invalid) onSubmit(trimmed)
            }}
          >
            <Field
              label="Label"
              required
              error={touched && invalid ? 'Enter a label.' : undefined}
              hint="Shown in the snapshot list and the comparison picker."
            >
              <Input
                value={label}
                autoFocus
                disabled={busy}
                aria-invalid={touched && invalid}
                onChange={(e) => {
                  setLabel(e.target.value)
                  setTouched(true)
                }}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || invalid}
          >
            Save snapshot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface KeepSnapshotDialogProps {
  snapshot: SnapshotVersion | null
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onSubmit: (reason: string) => void
}

const KEEP_REASON_MAX = 500

/**
 * DSET-04.3 — "Keep" a snapshot from retention. A reason is required because
 * the RPC stores it beside the snapshot and rejects an empty one; the value
 * is trimmed and length-checked here so the refusal never reaches the user as
 * a raw database error.
 */
function KeepSnapshotDialog({
  snapshot,
  onOpenChange,
  busy = false,
  onSubmit,
}: KeepSnapshotDialogProps) {
  const formId = 'keep-snapshot'
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const invalid = trimmed.length < 1 || trimmed.length > KEEP_REASON_MAX

  return (
    <Dialog
      open={snapshot !== null}
      onOpenChange={(next) => {
        if (!next) {
          setReason('')
          setTouched(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(460px,calc(100vw-32px))]">
        <DialogHeader
          title={snapshot ? `Keep ${snapshot.label}` : 'Keep snapshot'}
          description="Retention will not remove this snapshot’s rows while the keep is in force."
        />
        <DialogBody>
          <Notice tone="info" icon={false}>
            Keeping records why the rows are still needed. A signed record
            citing the snapshot is retained for longer and still takes
            precedence over a keep.
          </Notice>
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!invalid) onSubmit(trimmed)
            }}
          >
            <Field
              label="Reason"
              required
              error={
                touched && invalid
                  ? `Enter a reason up to ${KEEP_REASON_MAX} characters.`
                  : undefined
              }
              hint="Stored with the snapshot and shown in its history."
            >
              <Input
                value={reason}
                autoFocus
                disabled={busy}
                maxLength={KEEP_REASON_MAX}
                aria-invalid={touched && invalid}
                onChange={(e) => {
                  setReason(e.target.value)
                  setTouched(true)
                }}
                placeholder="e.g. Still needed for the 2027 stability review"
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || invalid}
          >
            {busy ? 'Keeping…' : 'Keep snapshot'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
