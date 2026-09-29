/**
 * AUTO-03 — pipeline_output notebook block editor: pick a Pipeline run and
 * pin its produced Dataset Version into the notebook. Empty drafts are
 * valid; choosing a run writes the run id plus the first output's Dataset
 * Version identity.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { NativeSelect } from '#/components/v3/projects/select'
import { Icon } from '#/components/v3/icons'
import { createDataClient } from '#/lib/data-client'
import { formatRelativeTime } from '#/lib/notebook-data'
import {
  listPipelineRunOutputs,
  listRecentPipelineRuns,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import type { AutosaveStatus, SaveResult } from './use-autosave'
import type { PipelineOutputBlockPayload } from './pipeline-output-block-preview'

const dataClient = createDataClient()

export function PipelineOutputBlockEditor({
  block,
  save,
  offline,
  onStatusChange,
  readOnly,
}: {
  block: { payload: unknown; payloadSchemaVersion: number }
  save: (
    payload: Record<string, unknown>,
  ) => Promise<SaveResult<Record<string, unknown>>>
  offline?: boolean
  onStatusChange?: (status: AutosaveStatus) => void
  readOnly?: boolean
}) {
  const initial = useMemo(
    () => (block.payload ?? {}) as PipelineOutputBlockPayload,
    [block.payload],
  )
  const [runId, setRunId] = useState<string>(initial.runId ?? '')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const runsQuery = useQuery({
    queryKey: ['pipelines', 'recent-runs'],
    queryFn: () => listRecentPipelineRuns(dataClient, 20),
  })
  const runs = runsQuery.data ?? []

  const outputsQuery = useQuery({
    queryKey: pipelineQueryKeys.runOutputs(runId),
    queryFn: () => listPipelineRunOutputs(dataClient, runId),
    enabled: Boolean(runId),
  })

  const selected = runs.find((r) => r.id === runId) ?? null

  async function chooseRun(nextRunId: string) {
    setRunId(nextRunId)
    setTouched(true)
    if (!nextRunId) {
      await persist({})
      return
    }
    const outputs = await listPipelineRunOutputs(dataClient, nextRunId)
    const first = outputs.length > 0 ? outputs[0] : null
    await persist({
      runId: nextRunId,
      datasetId: first?.dataset_id ?? null,
      datasetVersionId: first?.dataset_version_id ?? null,
      label: first?.label ?? null,
    })
  }

  async function persist(payload: Record<string, unknown>) {
    setSaving(true)
    try {
      const result = await save(payload)
      onStatusChange?.(result.ok ? 'clean' : 'failed')
    } catch {
      onStatusChange?.('failed')
    } finally {
      setSaving(false)
    }
  }

  const status = (run: PipelineRunWire) => {
    if (run.status === 'succeeded')
      return `succeeded · ${formatRelativeTime(run.finished_at ?? run.started_at)}`
    if (run.status === 'failed') return `failed · ${run.error_code ?? ''}`
    return run.status
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Icon
          name="pipeline"
          size={16}
          className="text-link"
          aria-hidden="true"
        />
        <span className="text-sm font-medium">Pipeline output reference</span>
      </div>

      <Field label="Pipeline run">
        <NativeSelect
          value={runId}
          onChange={(event) => void chooseRun(event.target.value)}
          aria-label="Pipeline run"
          disabled={readOnly}
        >
          <option value="">Select a run…</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id.slice(0, 8)} · {status(run)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {selected ? (
        <div className="text-fg-muted space-y-1 text-xs">
          <p>
            {outputsQuery.data?.length
              ? `Pins Dataset Version ${outputsQuery.data[0].dataset_version_id.slice(0, 8)} — ${outputsQuery.data[0].label}`
              : 'This run produced no recorded output.'}
          </p>
          <Link
            to="/pipelines/runs/$runId"
            params={{ runId: selected.id }}
            className="text-link underline-offset-2 hover:underline"
          >
            Inspect run
          </Link>
        </div>
      ) : null}

      {runId ? (
        <Field label="Or paste a run id">
          <Input
            className="mono"
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            onBlur={() => {
              if (touched && runId) void chooseRun(runId)
            }}
            aria-label="Pipeline run id"
            disabled={readOnly}
          />
        </Field>
      ) : null}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || !touched}
            onClick={() => void persist({})}
          >
            Clear reference
          </Button>
          {offline ? (
            <span className="text-fg-muted text-xs">
              offline — changes will sync
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}
