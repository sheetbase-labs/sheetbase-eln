import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Banner } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
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
import { rebindSpec } from '#/lib/analysis-rebind'
import {
  analysisStudioDataClient,
  captureSourceRevisions,
  createAnalysisView,
  fetchDatasetSummaries,
} from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import { specSourceDatasetId } from '#/lib/analysis-spec-source'
import { fetchCanonicalDataset } from '#/lib/chart-data'
import { objectPath } from '#/lib/navigation'

/**
 * Run a saved analysis on other data. The copy keeps the chart, filters and
 * transformations, points them at the chosen dataset, and is saved as its own
 * analysis; the original is untouched. Columns are matched by identity, then by
 * name and type, and the preview lists the match. If a bound column has no
 * counterpart the copy is refused and the missing column is named.
 */
export function DuplicateAnalysisDialog({
  view,
  workspaceId,
  userId,
  open,
  onOpenChange,
  client = analysisStudioDataClient,
}: {
  view: AnalysisViewWire
  workspaceId: string
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: typeof analysisStudioDataClient
}) {
  const navigate = useNavigate()
  const sourceId = specSourceDatasetId(view.charts[0])
  const [targetId, setTargetId] = useState('')
  const [name, setName] = useState('')
  const datasets = useQuery({
    queryKey: ['ui-port', 'analysis-duplicate', 'datasets'],
    queryFn: () => fetchDatasetSummaries(client),
    enabled: open,
  })
  const options = (datasets.data ?? []).filter((d) => d.id !== sourceId)
  const source = useQuery({
    queryKey: ['ui-port', 'analysis-duplicate', 'source', sourceId],
    queryFn: () => fetchCanonicalDataset(client, sourceId ?? ''),
    enabled: open && Boolean(sourceId),
  })
  const target = useQuery({
    queryKey: ['ui-port', 'analysis-duplicate', 'target', targetId],
    queryFn: () => fetchCanonicalDataset(client, targetId),
    enabled: open && Boolean(targetId),
  })
  const rebound = useMemo(
    () =>
      source.data && target.data
        ? rebindSpec(view.charts[0], source.data.columns, {
            datasetId: target.data.datasetId,
            columns: target.data.columns,
          })
        : null,
    [view.charts[0], source.data, target.data],
  )
  const save = useMutation({
    mutationFn: async () => {
      if (!rebound?.spec || !target.data) throw new Error('Nothing to save.')
      return createAnalysisView(
        client,
        {
          name: name.trim() || `${view.name} on ${target.data.name}`,
          charts: [rebound.spec],
          source_revisions: captureSourceRevisions([target.data], rebound.spec),
          export_settings: view.export_settings,
        },
        workspaceId,
        userId,
      )
    },
    onSuccess: (created) => {
      onOpenChange(false)
      toast('Analysis copied onto the new data')
      const to = objectPath('analysis', created.id)
      if (to) void navigate({ to } as never)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title="Run this analysis on other data"
          description="Saves a copy pointed at another dataset. The original stays as it is."
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label="Dataset">
              <Select
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.target.value)
                  setName('')
                }}
              >
                <option value="">Choose a dataset</option>
                {options.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            {target.isLoading || source.isLoading ? (
              <p className="m-0 text-label text-fg-muted">Matching columns…</p>
            ) : null}
            {rebound && rebound.spec ? (
              <>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-label">
                  {rebound.matches.map((m) => (
                    <li key={m.fromFieldId}>
                      {m.fromLabel}
                      {m.by === 'label' ? ` → ${m.toLabel}` : ' (same column)'}
                    </li>
                  ))}
                </ul>
                <Field label="Name">
                  <Input
                    value={name}
                    placeholder={`${view.name} on ${target.data?.name ?? ''}`}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {rebound && !rebound.spec ? (
              <Banner tone="warn" title="This dataset cannot take the analysis">
                It has no column matching {rebound.unmatched.join(', ')}. Choose
                a dataset with those columns, or add them to this one first.
              </Banner>
            ) : null}
            {save.isError ? (
              <p role="alert" className="m-0 text-label text-danger-text">
                {save.error instanceof Error
                  ? save.error.message
                  : 'Could not save the copy.'}
              </p>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={!rebound?.spec || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
