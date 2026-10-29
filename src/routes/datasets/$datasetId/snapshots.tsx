import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DialogRootActions } from '@base-ui/react/dialog'

import { t } from '#/copy'
import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import { CiteSnapshotDialog } from '#/components/v3/datasets/cite-snapshot-dialog'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
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
import { formatDate } from '#/lib/format-date'

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

function Snapshots() {
  const { datasetId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const versions = useDatasetVersions(datasetId)
  const rows = (versions.data ?? []) as unknown as SnapshotVersion[]
  const [selected, setSelected] = useState<string | null>(null)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selected,
    setSelected,
  )
  const columns: RegistryColumn<SnapshotVersion>[] = [
    {
      id: 'snapshot',
      header: t('data.datasetSnapshots.snapshot2'),
      cell: ({ row }) => (
        <span
          className={cn(
            'mono',
            row.original.id === current?.id && 'font-semibold',
          )}
        >
          {row.original.label}
        </span>
      ),
      meta: {
        headerClassName: stickyHead,
        cellClassName: stickyCell,
      },
    },
    {
      id: 'saved',
      header: t('common.states.saved'),
      cell: ({ row }) => row.original.createdAt.slice(0, 16).replace('T', ' '),
    },
    {
      id: 'rows',
      header: t('data.datasetSnapshots.rows'),
      cell: ({ row }) =>
        isSnapshotTombstone(row.original) ? (
          <span className="text-fg-muted">
            {t('data.datasetSnapshots.removed')}
          </span>
        ) : (
          row.original.rowCount
        ),
      meta: rightAligned<SnapshotVersion>().meta,
    },
    {
      id: 'revision',
      header: t('data.datasetSnapshots.sourceRevision'),
      cell: ({ row }) => row.original.sourceDatasetRevision,
      meta: { cellClassName: 'num' },
    },
    {
      id: 'retention',
      header: t('data.datasetSnapshots.retention'),
      cell: ({ row }) => {
        const view = describeSnapshotKeeping(row.original)
        return view ? <Status tone={view.tone}>{view.label}</Status> : null
      },
    },
  ]
  const [dialogOpen, setDialogOpen] = useState(false)
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [keepTarget, setKeepTarget] = useState<SnapshotVersion | null>(null)
  const [citeTarget, setCiteTarget] = useState<SnapshotVersion | null>(null)
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
  // A failed read is not an archive state: say which it is, so the disabled
  // action does not blame the dataset's lifecycle for a broken request.
  const snapshotDisabledReason = !canWrite
    ? t('data.datasetSnapshots.haveReadAccessDataset')
    : datasetQuery.isLoading
      ? t('data.datasetSnapshots.checkingDatasetSCurrent')
      : datasetQuery.isError
        ? t('data.datasetSnapshots.datasetSCurrentRevision')
        : !datasetQuery.data
          ? t('data.datasetSnapshots.datasetLongerReadableHere')
          : datasetQuery.data.lifecycle !== 'active'
            ? t('data.datasetSnapshots.archivedDatasetsCannotSnapshotted')
            : null

  // base-ui keeps a closed popup in the document until a frame has painted past
  // its exit transition. A hidden or throttled tab may never deliver that frame,
  // which leaves the closed dialog on screen with live controls — clicking
  // "Save snapshot" again would then write a second snapshot. Unmounting on
  // close is base-ui's documented way to take the dialog out of the document
  // immediately, so a closed confirmation can never be submitted twice.
  const createDialogActions = useRef<DialogRootActions | null>(null)
  const keepDialogActions = useRef<DialogRootActions | null>(null)

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
      toast(t('data.datasetSnapshots.snapshotSaved', { label: created.label }))
    },
    onError: (cause) =>
      toast(t('data.datasetSnapshots.couldSaveSnapshot'), {
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
      toast(
        t('data.datasetSnapshots.snapshotKept', { label: input.version.label }),
        {
          description: t('data.datasetSnapshots.rowsRemovedRetentionWhile'),
        },
      )
    },
    onError: (cause) =>
      toast(t('data.datasetSnapshots.couldKeepSnapshot'), {
        description: describeKeepError(cause),
      }),
  })

  useEffect(() => {
    if (!dialogOpen) createDialogActions.current?.unmount()
  }, [dialogOpen])
  useEffect(() => {
    if (!keepTarget) keepDialogActions.current?.unmount()
  }, [keepTarget])

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
                  {t('data.datasetSnapshots.keep', {
                    label: pruneWarning.label,
                  })}
                </Button>
              ) : undefined
            }
          >
            {pruneWarning.detail}
          </Notice>
        ) : null}
        <Notice icon="lock">
          {t('data.datasetSnapshots.snapshotNeverChangesRecords')}
        </Notice>
        {datasetQuery.isError ? (
          <Notice
            tone="warn"
            title={t('data.datasetSnapshots.snapshotCheckUnavailable')}
          >
            {t('data.datasetSnapshots.datasetSCurrentRevision')}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Muted className="max-w-[52ch]">
            {t('data.datasetSnapshots.importsPipelinesSaveSnapshots')}
          </Muted>
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            disabled={!canSnapshot}
            title={snapshotDisabledReason ?? undefined}
            onClick={() => setDialogOpen(true)}
          >
            {t('data.datasetSnapshots.createSnapshot')}
          </Button>
        </div>
        {rows.length ? (
          <TableBox>
            <RegistryGrid
              label={t('data.datasetSnapshots.datasetSnapshots')}
              rows={rows}
              columns={columns}
              getRowId={(v) => v.id}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onRowClick={(v) => setSelected(v.id)}
              selectable={false}
            />
          </TableBox>
        ) : (
          <Muted>
            {versions.isLoading
              ? t('data.datasetSnapshots.loadingSnapshots')
              : t('data.datasetSnapshots.snapshotsYetSnapshotDataset')}
          </Muted>
        )}
        {!canWrite ? (
          <Notice tone="info" icon={false}>
            {t('data.datasetSnapshots.haveReadAccessDataset')}
          </Notice>
        ) : null}
      </div>

      {current ? (
        <Inspector className="w-[320px]">
          <InspectorSection
            title={t('data.datasetSnapshots.snapshot', {
              label: current.label,
            })}
          >
            <DescriptionList
              labelWidth={96}
              items={[
                [
                  t('common.states.saved'),
                  current.createdAt.slice(0, 16).replace('T', ' '),
                ],
                [
                  t('data.datasetSnapshots.rows'),
                  tombstone
                    ? t('data.datasetSnapshots.removed')
                    : String(current.rowCount),
                ],
                [
                  t('data.datasetSnapshots.sourceRevision'),
                  String(current.sourceDatasetRevision),
                ],
                [
                  t('data.datasetSnapshots.madeBy'),
                  current.createdByName ??
                    current.createdByUserId ??
                    current.createdByCredentialId ??
                    '—',
                ],
                [
                  t('data.datasetSnapshots.source'),
                  describeSnapshotSource(current.source),
                ],
                ...(previous
                  ? ([[t('common.actions.previous'), previous.label]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
                ...(current.rowsRemovedAt
                  ? ([
                      [
                        t('data.datasetSnapshots.rowsRemoved'),
                        formatDate(current.rowsRemovedAt),
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
          </InspectorSection>
          <InspectorSection title={t('data.datasetSnapshots.citedBy')}>
            <div className="flex flex-col gap-1.5">
              {citedCount === 0 ? (
                <Muted>{t('data.datasetSnapshots.citedAnySignedRecord')}</Muted>
              ) : (
                <>
                  <Muted>
                    {t('data.datasetSnapshots.signedRunsAnalyses', {
                      signedRevisions: citations.signedRevisions,
                      pipelineRuns: citations.pipelineRuns,
                      analyses: citations.analyses,
                    })}
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
          {canWrite && !tombstone ? (
            <InspectorSection title={t('data.datasetSnapshots.notebook')}>
              <div className="flex flex-col gap-1.5">
                <Muted>
                  {t('data.datasetSnapshots.referenceExactSnapshotFrom')}
                </Muted>
                <Button size="sm" onClick={() => setCiteTarget(current)}>
                  {t('data.datasetSnapshots.citeNotebook')}
                </Button>
              </div>
            </InspectorSection>
          ) : null}
          {!tombstone ? (
            <InspectorSection title={t('data.datasetSnapshots.analysis')}>
              <div className="flex flex-col gap-1.5">
                <Muted>
                  {t('data.datasetSnapshots.chartAnalyseRowsExactly')}
                </Muted>
                <Link
                  to="/analysis/new"
                  search={{
                    dataset: datasetId,
                    snapshot: current.id,
                    mode: 'analyse',
                  }}
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'justify-center',
                  )}
                >
                  {t('data.datasetSnapshots.analyseSnapshot')}
                </Link>
              </div>
            </InspectorSection>
          ) : null}
          <InspectorSection title={t('data.datasetSnapshots.contentHash')}>
            {tombstone ? (
              <Muted>
                {t('data.datasetSnapshots.shownAfterRemovalSnapshot')}
              </Muted>
            ) : (
              <span className="mono break-all text-[11px] leading-[16px]">
                {current.contentHash}
              </span>
            )}
          </InspectorSection>
          <InspectorSection
            title={
              tombstone
                ? t('data.datasetSnapshots.whatSLeft')
                : t('data.datasetSnapshots.keeping')
            }
          >
            {keeping ? (
              <div className="flex flex-col gap-2">
                <Status tone={keeping.tone}>{keeping.label}</Status>
                <Muted>{keeping.detail}</Muted>
                {tombstone ? (
                  <>
                    <Muted>
                      {t('data.datasetSnapshots.rule', {
                        rule: describeSnapshotTombstone(current).rule,
                      })}
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
                    {t('data.datasetSnapshots.keep', { label: current.label })}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </InspectorSection>
          <InspectorSection title={t('data.datasetSnapshots.compare')}>
            {tombstone ? (
              <Muted>{t('data.datasetSnapshots.rowsWereRemovedSo')}</Muted>
            ) : others.length && compareTarget ? (
              <div className="flex flex-col gap-2">
                <label className="sr-only" htmlFor="compare-with">
                  {t('data.datasetSnapshots.compareWith')}
                </label>
                <Select
                  id="compare-with"
                  className="min-w-0"
                  value={compareTarget}
                  onChange={(e) => setCompareWith(e.target.value)}
                >
                  {others.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} · {formatDate(v.createdAt)}
                    </option>
                  ))}
                </Select>
                <Link
                  to="/datasets/$datasetId/compare"
                  params={{ datasetId }}
                  search={{ from: current.id, to: compareTarget }}
                  className={cn(
                    buttonVariants({ variant: 'secondary', size: 'sm' }),
                    'justify-center',
                  )}
                >
                  {t('data.datasetSnapshots.compareSnapshots')}
                </Link>
              </div>
            ) : (
              <Muted>
                {t('data.datasetSnapshots.saveAnotherSnapshotCompare')}
              </Muted>
            )}
          </InspectorSection>
        </Inspector>
      ) : null}

      <CreateSnapshotDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        actionsRef={createDialogActions}
        defaultLabel={`${context.user.name} · saved by hand`}
        busy={create.isPending}
        onSubmit={(label) => create.mutate(label)}
      />

      <KeepSnapshotDialog
        key={keepTarget?.id ?? 'none'}
        snapshot={keepTarget}
        actionsRef={keepDialogActions}
        onOpenChange={(open) => {
          if (!open) setKeepTarget(null)
        }}
        busy={keep.isPending}
        onSubmit={(reason) => {
          if (keepTarget) keep.mutate({ version: keepTarget, reason })
        }}
      />

      {citeTarget ? (
        <CiteSnapshotDialog
          datasetId={datasetId}
          snapshot={citeTarget}
          onClose={() => setCiteTarget(null)}
        />
      ) : null}
    </>
  )
}

interface CreateSnapshotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionsRef: React.RefObject<DialogRootActions | null>
  defaultLabel: string
  busy?: boolean
  onSubmit: (label: string) => void
}

/**
 * "Save a snapshot now" dialog. A label is required so the snapshot list and
 * comparison stay readable; the value is trimmed by the product helper before
 * it reaches the RPC. `actionsRef` lets the caller take the dialog out of the
 * document the moment the snapshot is saved, so the confirmation cannot be
 * submitted twice.
 */
function CreateSnapshotDialog({
  open,
  onOpenChange,
  actionsRef,
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
      actionsRef={actionsRef}
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
          title={t('data.datasetSnapshots.createSnapshot')}
          description={t('data.datasetSnapshots.freezeDatasetSCurrent')}
        />
        <DialogBody>
          <Notice tone="info" icon={false}>
            {t('data.datasetSnapshots.snapshotNeverChangesLater')}
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
              label={t('data.datasetSnapshots.label')}
              required
              error={
                touched && invalid
                  ? t('data.datasetSnapshots.enterLabel')
                  : undefined
              }
              hint={t('data.datasetSnapshots.shownSnapshotListComparison')}
            >
              <Input
                value={label}
                autoFocus
                required
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
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || invalid}
          >
            {t('data.datasetSnapshots.saveSnapshot')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface KeepSnapshotDialogProps {
  snapshot: SnapshotVersion | null
  onOpenChange: (open: boolean) => void
  actionsRef: React.RefObject<DialogRootActions | null>
  busy?: boolean
  onSubmit: (reason: string) => void
}

const KEEP_REASON_MAX = 500

/**
 * DSET-04.3 — "Keep" a snapshot from retention. A reason is required because
 * the RPC stores it beside the snapshot and rejects an empty one; the value
 * is trimmed and length-checked here so the refusal never reaches the user as
 * a raw database error. Like the create dialog, it is unmounted by its caller
 * once the keep is recorded, so it cannot be submitted a second time.
 */
function KeepSnapshotDialog({
  snapshot,
  onOpenChange,
  actionsRef,
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
      actionsRef={actionsRef}
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
          title={
            snapshot
              ? t('data.datasetSnapshots.keep', { label: snapshot.label })
              : t('data.datasetSnapshots.keepSnapshot')
          }
          description={t('data.datasetSnapshots.retentionRemoveSnapshotS')}
        />
        <DialogBody>
          <Notice tone="info" icon={false}>
            {t('data.datasetSnapshots.keepingRecordsWhyRows')}
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
              label={t('data.datasetSnapshots.reason')}
              required
              error={
                touched && invalid
                  ? t('data.datasetSnapshots.enterReasonUpCharacters', {
                      KEEP_REASON_MAX,
                    })
                  : undefined
              }
              hint={t('data.datasetSnapshots.storedSnapshotShownHistory')}
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
                placeholder={t(
                  'data.datasetSnapshots.placeholderEGStillNeeded',
                )}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || invalid}
          >
            {busy
              ? t('data.datasetSnapshots.keeping2')
              : t('data.datasetSnapshots.keepSnapshot')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
