import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { t } from '#/copy'
import { DescriptionList, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { toast } from '#/components/v3/ui/sonner'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { RecordPickerDialog } from '#/components/v3/record-picker/record-picker'
import {
  datasetIssueSummary,
  datasetValidation,
  useDatasetSummaries,
} from '#/components/v3/datasets/datasets-data'
import type { DatasetListRow } from '#/components/v3/datasets/datasets-data'
import { DatasetIssueActions } from '#/components/v3/datasets/dataset-inspector'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { useDatasetVersions } from '../$datasetId'
import { RelationshipPanel } from '#/components/knowledge/relationship-panel'
import { RecordLineageSection } from '#/components/knowledge/record-lineage-section'

/**
 * R5-SURF-01 — the dataset detail index, which is the Overview screen the
 * Overview tab links to.
 *
 * Imports, Used by and History are selected by the `view` search parameter on
 * the parent dataset detail route (the layout renders the panel and skips this
 * Outlet), so each is a linkable, reloadable URL (`/datasets/<id>?view=imports`).
 */
export const Route = createFileRoute('/datasets/$datasetId/')({
  component: DatasetOverview,
})

function DatasetOverview() {
  const { datasetId } = Route.useParams()
  const summaries = useDatasetSummaries()
  const dataset = summaries.data?.find((d) => d.uuid === datasetId)
  if (!dataset) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>
          {summaries.isLoading
            ? t('data.datasetOverview.loadingDataset')
            : t('data.datasetOverview.datasetFound')}
        </Muted>
      </div>
    )
  }
  return <DatasetOverviewPanel dataset={dataset} />
}

/**
 * The dataset Overview: what the record is, where it came from and what state
 * it is in. The facts that only exist here — provenance, snapshot state and
 * unresolved flags — are the point; identity already sits in the frame header.
 */
function DatasetOverviewPanel({ dataset }: { dataset: DatasetListRow }) {
  const versions = useDatasetVersions(dataset.uuid)
  const { userLabel } = useUserNames(
    dataset.createdByUserId ? [dataset.createdByUserId] : [],
  )
  const project = useQuery({
    queryKey: ['ui-port', 'dataset-project', dataset.projectId],
    enabled: Boolean(dataset.projectId),
    queryFn: () =>
      notebookDataClient
        .list<{ id: string; title: string }>(
          'projects',
          `?id=eq.${dataset.projectId}&select=id,title&limit=1`,
        )
        .then((rows) => rows.at(0) ?? null),
  })

  const snapshots = versions.data ?? []
  const latest = snapshots.at(0)
  const validation = datasetValidation(dataset)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-[22px] md:px-8">
      <Section title={t('data.datasetOverview.summary')}>
        <DescriptionList
          items={[
            [t('data.datasetOverview.datasetSchema'), dataset.model],
            [
              t('data.datasetOverview.project'),
              dataset.projectId
                ? (project.data?.title ??
                  (project.isLoading
                    ? 'Loading…'
                    : t('data.datasetOverview.restrictedProject')))
                : t('data.datasetOverview.noProject'),
            ],
            [
              t('data.datasetOverview.owner'),
              dataset.createdByUserId
                ? userLabel(dataset.createdByUserId)
                : '—',
            ],
            [
              t('data.datasetOverview.experiment'),
              dataset.experimentId ? (
                <ObjectLink
                  kind="experiment"
                  identifier={dataset.experimentId}
                />
              ) : (
                <LinkToExperiment dataset={dataset} />
              ),
            ],
            [
              t('data.datasetOverview.rows'),
              <span className="num">{dataset.rows}</span>,
            ],
            [
              t('data.datasetOverview.snapshots'),
              snapshots.length
                ? `${snapshots.length} · latest ${latest!.label}`
                : t('data.datasetOverview.noneYet'),
            ],
            [
              t('data.datasetOverview.state'),
              <Status tone={validation.tone}>{validation.label}</Status>,
            ],
          ]}
        />
      </Section>

      <Section
        title={t('data.datasetOverview.issues')}
        count={dataset.issues || undefined}
      >
        {dataset.issues ? (
          <>
            <Muted>{datasetIssueSummary(dataset)}</Muted>
            <DatasetIssueActions dataset={dataset} />
          </>
        ) : (
          <Muted>{t('data.datasetOverview.unresolvedValueFlagsFlags')}</Muted>
        )}
      </Section>

      {dataset.archived ? (
        <Section title={t('data.datasetOverview.archived')}>
          <Muted>
            {t('data.datasetOverview.datasetArchivedStaysReadable')}
          </Muted>
        </Section>
      ) : null}
      <RelationshipPanel recordId={dataset.uuid} />
      <RecordLineageSection recordId={dataset.uuid} />
    </div>
  )
}

/** The dataset's experiment link is written from the experiment's side, so
 * choosing the experiment here writes the same `dataset` link the import does
 * and every tab that reads it (the experiment's Datasets and Results, this
 * Overview) shows it. */
function LinkToExperiment({ dataset }: { dataset: DatasetListRow }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const link = useMutation({
    mutationFn: async (items: { id: string; identifier: string }[]) => {
      const experiment = items.at(0)
      if (!experiment) return
      await notebookDataClient.rpc('create_record_link', {
        p_source_record_id: experiment.id,
        p_target_kind: 'dataset',
        p_target_identifier: dataset.id,
        p_link_type: 'dataset',
        p_target_record_id: null,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ui-port'] })
      toast(t('data.datasetOverview.datasetLinkedExperiment'))
    },
    onError: (error: unknown) =>
      toast(t('data.datasetOverview.couldLinkDataset'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.datasetOverview.linkRefused'),
      }),
  })
  return (
    <span className="flex items-center gap-2">
      <span className="text-fg-muted">
        {t('data.datasetOverview.linkedExperiment')}
      </span>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('data.datasetOverview.linkExperiment')}
      </Button>
      {open ? (
        <RecordPickerDialog
          open={open}
          onOpenChange={setOpen}
          title={t('data.datasetOverview.linkExperiment2')}
          allowed={['Experiment']}
          confirmLabel={() => t('data.datasetOverview.link')}
          onPick={(items) => link.mutate(items)}
        />
      ) : null}
    </span>
  )
}
