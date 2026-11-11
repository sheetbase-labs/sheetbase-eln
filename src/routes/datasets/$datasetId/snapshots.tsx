import { createFileRoute } from '@tanstack/react-router'

import { t } from '#/copy'
import { Notice } from '#/components/ui/alert'
import { CiteSnapshotDialog } from '#/components/datasets/cite-snapshot-dialog'
import { snapshotColumns } from './-snapshots-columns'
import { CreateSnapshotDialog, KeepSnapshotDialog } from './-snapshots-dialogs'
import { useSnapshotsScreen } from './-snapshots-model'
import {
  SnapshotInspector,
  SnapshotsHeader,
  SnapshotsList,
} from './-snapshots-parts'

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
  const screen = useSnapshotsScreen({ datasetId, viewer: context })
  const columns = snapshotColumns(screen.current)

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
        <SnapshotsHeader
          pruneWarning={screen.pruneWarning}
          canWrite={screen.canWrite}
          canSnapshot={screen.canSnapshot}
          disabledReason={screen.disabledReason}
          datasetFailed={screen.datasetFailed}
          onCreate={() => screen.setDialogOpen(true)}
          onKeepVersion={screen.requestKeep}
        />
        <SnapshotsList
          rows={screen.rows}
          columns={columns}
          versionsLoading={screen.versionsLoading}
          rowSelection={screen.rowSelection}
          onRowSelectionChange={screen.onRowSelectionChange}
          onSelect={screen.setSelected}
        />
        {!screen.canWrite ? (
          <Notice tone="info" icon={false}>
            {t('data.datasetSnapshots.haveReadAccessDataset')}
          </Notice>
        ) : null}
      </div>

      {screen.current ? (
        <SnapshotInspector
          datasetId={datasetId}
          workspaceId={context.workspace?.id ?? ''}
          snapshot={screen.current}
          previous={screen.previous}
          others={screen.others}
          keeping={screen.keeping}
          tombstone={screen.tombstone}
          citations={screen.citations}
          citationLines={screen.citationLines}
          citedCount={screen.citedCount}
          canWrite={screen.canWrite}
          producingRun={screen.producingRun.data}
          compareTarget={screen.compareTarget}
          onCompareChange={screen.setCompareWith}
          onCite={() => screen.setCiteTarget(screen.current ?? null)}
          onKeep={() => screen.setKeepTarget(screen.current ?? null)}
        />
      ) : null}

      <CreateSnapshotDialog
        open={screen.dialogOpen}
        onOpenChange={screen.setDialogOpen}
        actionsRef={screen.createDialogActions}
        defaultLabel={`${context.user.name} · saved by hand`}
        busy={screen.create.isPending}
        onSubmit={(label) => screen.create.mutate(label)}
      />

      <KeepSnapshotDialog
        key={screen.keepTarget?.id ?? 'none'}
        snapshot={screen.keepTarget}
        actionsRef={screen.keepDialogActions}
        onOpenChange={(open) => {
          if (!open) screen.setKeepTarget(null)
        }}
        busy={screen.keep.isPending}
        onSubmit={(reason) => {
          if (screen.keepTarget)
            screen.keep.mutate({ version: screen.keepTarget, reason })
        }}
      />

      {screen.citeTarget ? (
        <CiteSnapshotDialog
          datasetId={datasetId}
          snapshot={screen.citeTarget}
          onClose={() => screen.setCiteTarget(null)}
        />
      ) : null}
    </>
  )
}
