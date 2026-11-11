/**
 * The Snapshots tab's presentational sections: its notices and Create action,
 * the snapshot list, and the inspector beside it.
 *
 * Each section reads named values and reports intent back; none of them fetch,
 * mutate or own the selection, so the route can be read top to bottom.
 */
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Status } from '#/components/ui/status'
import { Notice } from '#/components/ui/alert'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { OnChangeFn, RowSelectionState } from '@tanstack/react-table'
import { Button, buttonVariants } from '#/components/ui/button'
import { PublishControl } from '#/components/open-data/publish-control'
import { SnapshotReproduce } from '#/components/pipelines/run-reproduction'
import { Select } from '#/components/ui/select'
import type {
  SnapshotCitationCounts,
  SnapshotPruneWarning,
  SnapshotRetentionView,
  SnapshotVersion,
} from '#/components/datasets/snapshot-data'
import {
  describeRetentionPolicy,
  describeSnapshotSource,
  describeSnapshotTombstone,
  isSnapshotPrunable,
} from '#/components/datasets/snapshot-data'
import { cn } from '#/lib/utils'
import { formatDate } from '#/lib/format-date'
import { previousRows, removedRows } from './-snapshots-model'

/** The run that produced a snapshot, when one is recorded. */
export interface ProducingRun {
  runId: string
  pipelineId: string
  pipelineName: string
  runNumber: number | null
}

/**
 * The tab's notices and its Create action: the prune warning, what a snapshot
 * is, and whether the Dataset's current revision could be read.
 */
export function SnapshotsHeader({
  pruneWarning,
  canWrite,
  canSnapshot,
  disabledReason,
  datasetFailed,
  onCreate,
  onKeepVersion,
}: {
  pruneWarning: SnapshotPruneWarning | null
  canWrite: boolean
  canSnapshot: boolean
  disabledReason: string | null
  datasetFailed: boolean
  onCreate: () => void
  onKeepVersion: (versionId: string) => void
}) {
  return (
    <>
      {pruneWarning ? (
        <Notice
          tone="warn"
          title={pruneWarning.title}
          action={
            canWrite ? (
              <Button
                size="sm"
                onClick={() => onKeepVersion(pruneWarning.versionId)}
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
      {datasetFailed ? (
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
          title={disabledReason ?? undefined}
          onClick={onCreate}
        >
          {t('data.datasetSnapshots.createSnapshot')}
        </Button>
      </div>
    </>
  )
}

/** The snapshot list, or what the tab says while it has none to show. */
export function SnapshotsList({
  rows,
  columns,
  versionsLoading,
  rowSelection,
  onRowSelectionChange,
  onSelect,
}: {
  rows: SnapshotVersion[]
  columns: RegistryColumn<SnapshotVersion>[]
  versionsLoading: boolean
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  onSelect: (id: string) => void
}) {
  if (!rows.length) {
    return (
      <Muted>
        {versionsLoading
          ? t('data.datasetSnapshots.loadingSnapshots')
          : t('data.datasetSnapshots.snapshotsYetSnapshotDataset')}
      </Muted>
    )
  }

  return (
    <TableBox>
      <RegistryGrid
        label={t('data.datasetSnapshots.datasetSnapshots')}
        rows={rows}
        columns={columns}
        getRowId={(v) => v.id}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
        onRowClick={(v) => onSelect(v.id)}
        selectable={false}
      />
    </TableBox>
  )
}

/** The full snapshot read model, beside the list. */
export function SnapshotInspector({
  datasetId,
  workspaceId,
  snapshot,
  previous,
  others,
  keeping,
  tombstone,
  citations,
  citationLines,
  citedCount,
  canWrite,
  producingRun,
  compareTarget,
  onCompareChange,
  onCite,
  onKeep,
}: {
  datasetId: string
  workspaceId: string
  snapshot: SnapshotVersion
  previous: SnapshotVersion | undefined
  others: SnapshotVersion[]
  keeping: SnapshotRetentionView | null
  tombstone: boolean
  citations: SnapshotCitationCounts
  citationLines: string[]
  citedCount: number
  canWrite: boolean
  producingRun: ProducingRun | null | undefined
  compareTarget: string | null
  onCompareChange: (id: string) => void
  onCite: () => void
  onKeep: () => void
}) {
  // Citing, publishing and keeping are writes: a tombstone has nothing to act
  // on, so neither the action nor its section is offered.
  const canAct = canWrite && !tombstone

  return (
    <Inspector className="w-[320px]">
      <SnapshotFactsSection
        snapshot={snapshot}
        previous={previous}
        tombstone={tombstone}
      />
      <SnapshotCitationsSection
        citations={citations}
        citedCount={citedCount}
        citationLines={citationLines}
      />
      {producingRun ? (
        <InspectorSection title={t('data.reproduce.producedBy')}>
          <SnapshotReproduce
            runId={producingRun.runId}
            pipelineId={producingRun.pipelineId}
            pipelineName={producingRun.pipelineName}
            runNumber={producingRun.runNumber}
            canReproduce={canAct}
          />
        </InspectorSection>
      ) : null}
      {canAct ? (
        <InspectorSection title={t('data.datasetSnapshots.notebook')}>
          <div className="flex flex-col gap-1.5">
            <Muted>
              {t('data.datasetSnapshots.referenceExactSnapshotFrom')}
            </Muted>
            <Button size="sm" onClick={onCite}>
              {t('data.datasetSnapshots.citeNotebook')}
            </Button>
          </div>
        </InspectorSection>
      ) : null}
      {canAct ? (
        <InspectorSection title={t('openData.publish.action')}>
          <div className="flex flex-wrap items-center gap-2">
            <PublishControl
              workspaceId={workspaceId}
              kind="dataset_version"
              objectId={snapshot.id}
              defaultTitle={snapshot.label}
              canPublish={canWrite}
            />
          </div>
        </InspectorSection>
      ) : null}
      {tombstone ? null : (
        <SnapshotAnalyseSection
          datasetId={datasetId}
          snapshotId={snapshot.id}
        />
      )}
      <SnapshotContentHashSection
        contentHash={snapshot.contentHash}
        tombstone={tombstone}
      />
      <SnapshotRetentionSection
        snapshot={snapshot}
        keeping={keeping}
        canWrite={canWrite}
        tombstone={tombstone}
        onKeep={onKeep}
      />
      <SnapshotCompareSection
        datasetId={datasetId}
        snapshotId={snapshot.id}
        others={others}
        compareTarget={compareTarget}
        tombstone={tombstone}
        onCompareChange={onCompareChange}
      />
    </Inspector>
  )
}

/** Saved, rows, revision, who made it, from what, and what it replaced. */
function SnapshotFactsSection({
  snapshot,
  previous,
  tombstone,
}: {
  snapshot: SnapshotVersion
  previous: SnapshotVersion | undefined
  tombstone: boolean
}) {
  return (
    <InspectorSection
      title={t('data.datasetSnapshots.snapshot', { label: snapshot.label })}
    >
      <DescriptionList
        labelWidth={96}
        items={[
          [
            t('common.states.saved'),
            formatDate(snapshot.createdAt, { time: true }),
          ],
          [
            t('data.datasetSnapshots.rows'),
            tombstone
              ? t('data.datasetSnapshots.removed')
              : String(snapshot.rowCount),
          ],
          [
            t('data.datasetSnapshots.sourceRevision'),
            String(snapshot.sourceDatasetRevision),
          ],
          [
            t('data.datasetSnapshots.madeBy'),
            snapshot.createdByName ??
              snapshot.createdByUserId ??
              snapshot.createdByCredentialId ??
              '—',
          ],
          [
            t('data.datasetSnapshots.source'),
            describeSnapshotSource(snapshot.source),
          ],
          ...previousRows(previous),
          ...removedRows(snapshot.rowsRemovedAt),
        ]}
      />
    </InspectorSection>
  )
}

/** What cites this snapshot, as counts and then each citation by name. */
function SnapshotCitationsSection({
  citations,
  citedCount,
  citationLines,
}: {
  citations: SnapshotCitationCounts
  citedCount: number
  citationLines: string[]
}) {
  return (
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
  )
}

/** The chart hand-off: analyse exactly this snapshot's rows. */
function SnapshotAnalyseSection({
  datasetId,
  snapshotId,
}: {
  datasetId: string
  snapshotId: string
}) {
  return (
    <InspectorSection title={t('data.datasetSnapshots.analysis')}>
      <div className="flex flex-col gap-1.5">
        <Muted>{t('data.datasetSnapshots.chartAnalyseRowsExactly')}</Muted>
        <Link
          to="/analysis/new"
          search={{
            dataset: datasetId,
            snapshot: snapshotId,
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
  )
}

/** The content hash, until the rows it hashed are gone. */
function SnapshotContentHashSection({
  contentHash,
  tombstone,
}: {
  contentHash: string | null
  tombstone: boolean
}) {
  return (
    <InspectorSection title={t('data.datasetSnapshots.contentHash')}>
      {tombstone ? (
        <Muted>{t('data.datasetSnapshots.shownAfterRemovalSnapshot')}</Muted>
      ) : (
        <span className="mono break-all text-[11px] leading-[16px]">
          {contentHash}
        </span>
      )}
    </InspectorSection>
  )
}

/** The retention standing, and the one action that outranks it. */
function SnapshotRetentionSection({
  snapshot,
  keeping,
  canWrite,
  tombstone,
  onKeep,
}: {
  snapshot: SnapshotVersion
  keeping: SnapshotRetentionView | null
  canWrite: boolean
  tombstone: boolean
  onKeep: () => void
}) {
  return (
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
                  rule: describeSnapshotTombstone(snapshot).rule,
                })}
              </Muted>
              <Muted>{describeSnapshotTombstone(snapshot).why}</Muted>
            </>
          ) : (
            <Muted>{describeRetentionPolicy(snapshot.retention)}</Muted>
          )}
          {canWrite && !tombstone && isSnapshotPrunable(snapshot.retention) ? (
            <Button size="sm" onClick={onKeep}>
              {t('data.datasetSnapshots.keep', { label: snapshot.label })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </InspectorSection>
  )
}

/** Pick another snapshot to compare against, and open the comparison. */
function SnapshotCompareSection({
  datasetId,
  snapshotId,
  others,
  compareTarget,
  tombstone,
  onCompareChange,
}: {
  datasetId: string
  snapshotId: string
  others: SnapshotVersion[]
  compareTarget: string | null
  tombstone: boolean
  onCompareChange: (id: string) => void
}) {
  return (
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
            onChange={(e) => onCompareChange(e.target.value)}
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
            search={{ from: snapshotId, to: compareTarget }}
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'justify-center',
            )}
          >
            {t('data.datasetSnapshots.compareSnapshots')}
          </Link>
        </div>
      ) : (
        <Muted>{t('data.datasetSnapshots.saveAnotherSnapshotCompare')}</Muted>
      )}
    </InspectorSection>
  )
}
