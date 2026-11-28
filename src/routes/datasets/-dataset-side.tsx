/**
 * The dataset page's side panel: its project, experiment and snapshots (the
 * header already says its structure, rows, owner and when it changed), then
 * what links to it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { DatasetListRow } from '#/components/datasets/datasets-data'
import { RecordPickerDialog } from '#/components/record-picker/record-picker'
import {
  RecordLinks,
  RecordProperties,
} from '#/components/record-page/record-side-panel'
import { Button } from '#/components/ui/button'
import { ObjectLink } from '#/components/ui/object-link'
import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { t } from '#/copy'

import type { DatasetVersion } from './$datasetId'

export function DatasetSidePanel({
  dataset,
  versions,
}: {
  dataset: DatasetListRow
  versions: readonly DatasetVersion[]
}) {
  const project = useQuery({
    queryKey: ['ui-port', 'dataset-project-title', dataset.projectId],
    enabled: Boolean(dataset.projectId),
    queryFn: () =>
      notebookDataClient
        .list<{ id: string; title: string }>(
          'projects',
          `?id=eq.${dataset.projectId}&select=id,title&limit=1`,
        )
        .then((rows) => rows.at(0) ?? null),
  })

  const latest = versions.at(0)

  return (
    <>
      <RecordProperties
        items={[
          {
            label: t('data.datasetOverview.project'),
            value: dataset.projectId ? (
              project.data?.title ? (
                <ObjectLink kind="project" id={dataset.projectId} mono={false}>
                  {project.data.title}
                </ObjectLink>
              ) : project.isLoading ? null : (
                t('data.datasetOverview.restrictedProject')
              )
            ) : null,
          },
          {
            label: t('data.datasetOverview.experiment'),
            value: dataset.experimentId ? (
              <ObjectLink kind="experiment" identifier={dataset.experimentId} />
            ) : (
              <LinkToExperiment dataset={dataset} />
            ),
          },
          {
            label: t('data.datasetOverview.snapshots'),
            value: latest
              ? `${versions.length} · latest ${latest.label}`
              : null,
          },
        ]}
      />
      <RecordLinks kind="dataset" id={dataset.uuid} />
    </>
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
    onError: (error) =>
      toast.error(t('data.datasetOverview.couldLinkDataset'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.datasetOverview.linkRefused'),
      }),
  })

  return (
    <span className="flex items-center gap-2">
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
