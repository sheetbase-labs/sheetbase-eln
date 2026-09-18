/**
 * AUTO-03 — run a published Pipeline version: supply explicit Dataset
 * Version inputs and typed parameters. The run is started through the
 * governed RPC (digest idempotency) and then executed server-side.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import { validatePipelineRunRequest } from '#/lib/pipelines/config'
import type { PipelineConfig } from '#/lib/pipelines/config'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import {
  executePipelineRun,
  pipelineQueryKeys,
  startPipelineRun,
} from '#/lib/pipelines/data'

export function RunPipelineDialog(
  props: React.ComponentProps<typeof RunPipelineDialogSession>,
) {
  return props.open ? <RunPipelineDialogSession {...props} /> : null
}

function RunPipelineDialogSession({
  dataClient,
  workspaceId,
  definitionVersionId,
  config,
  open,
  onOpenChange,
  onRunStarted,
  retryRun = null,
  initialInputVersions,
}: {
  dataClient: DataClient
  workspaceId: string
  definitionVersionId: string
  config: PipelineConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunStarted: (run: PipelineRunWire) => void
  retryRun?: PipelineRunWire | null
  /** Pre-fill input Dataset Version ids (e.g. Dataset → Pipeline integration). */
  initialInputVersions?: Record<string, string>
}) {
  const queryClient = useQueryClient()
  const [inputs, setInputs] = useState<Record<string, string>>(() => ({
    ...(retryRun?.input_versions ?? initialInputVersions ?? {}),
  }))
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(retryRun?.parameters ?? {}).map(([name, value]) => [
        name,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]),
    ),
  )
  const [invocationId] = useState(() => `manual:${crypto.randomUUID()}`)
  const isWorkflow = Boolean(
    config.actions?.length || config.notifications?.length,
  )
  const [error, setError] = useState('')

  const resolvedParams = useMemo(() => {
    if (retryRun) return retryRun.parameters
    const result: Record<string, unknown> = {}
    for (const parameter of config.parameters) {
      if (!Object.hasOwn(params, parameter.name)) continue
      const raw = params[parameter.name]
      if (raw === '') continue
      result[parameter.name] = coerceParameterValue(parameter.type, raw)
    }
    return result
  }, [params, config.parameters, retryRun])

  const requestErrors = useMemo(() => {
    const resolvedInputs: Record<string, string> = {}
    for (const input of config.inputs) {
      const value = (inputs[input.name] ?? '').trim()
      if (value) resolvedInputs[input.name] = value
    }
    return validatePipelineRunRequest(
      config,
      resolvedParams,
      retryRun?.input_versions ?? resolvedInputs,
    )
  }, [config, inputs, resolvedParams, retryRun])

  const runMutation = useMutation({
    mutationFn: async () => {
      const resolvedInputs: Record<string, string> = {}
      for (const input of config.inputs) {
        const value = (inputs[input.name] ?? '').trim()
        if (value) resolvedInputs[input.name] = value
      }
      const started = await startPipelineRun(dataClient, {
        workspaceId,
        definitionVersionId:
          retryRun?.definition_version_id ?? definitionVersionId,
        triggerKind: retryRun?.trigger_kind ?? 'manual',
        parameters: resolvedParams,
        inputVersions: retryRun?.input_versions ?? resolvedInputs,
        retryOfRunId: retryRun?.id ?? null,
        triggerOccurrenceId: retryRun
          ? retryRun.trigger_occurrence_id
          : isWorkflow
            ? invocationId
            : null,
        scheduleId: retryRun?.schedule_id ?? null,
      })
      if (started.status === 'running') {
        return executePipelineRun(started.id)
      }
      // Digest replay returned an already-succeeded run.
      return started
    },
    onSuccess: (run) => {
      setError('')
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.runs(
          retryRun?.definition_version_id ?? definitionVersionId,
        ),
      })
      onOpenChange(false)
      onRunStarted(run)
    },
    onError: (cause: unknown) => {
      setError(
        cause instanceof DataClientError
          ? cause.message
          : 'Could not run the Pipeline.',
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {retryRun ? 'Retry Pipeline run' : 'Run Pipeline'}
          </DialogTitle>
          <DialogDescription>
            {retryRun
              ? 'Retry the original version with the same inputs, parameters and trigger. These values cannot be changed for a retry.'
              : isWorkflow
                ? 'Choose any inputs and parameters. Each new invocation can perform the configured actions and send notifications.'
                : 'Choose saved dataset versions and any parameters. Repeating the same request returns the previous successful result.'}
          </DialogDescription>
        </DialogHeader>

        <fieldset
          className="min-w-0 space-y-4"
          disabled={Boolean(retryRun) || runMutation.isPending}
        >
          {config.inputs.length > 0 ? (
            <div className="space-y-3">
              <Label>Dataset inputs</Label>
              {config.inputs.map((input) => (
                <DatasetVersionPicker
                  key={input.name}
                  dataClient={dataClient}
                  name={input.name}
                  required={input.required}
                  value={inputs[input.name] ?? ''}
                  onChange={(value) =>
                    setInputs((previous) => ({
                      ...previous,
                      [input.name]: value,
                    }))
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This pipeline runs without dataset inputs.
            </p>
          )}

          {config.parameters.length > 0 && (
            <div className="space-y-2">
              <Label>Parameters</Label>
              {config.parameters.map((parameter) => (
                <div key={parameter.name} className="space-y-1">
                  <Label className="font-mono text-xs">
                    {parameter.name}
                    {parameter.required ? ' *' : ''} ({parameter.type})
                  </Label>
                  <Input
                    className="font-mono text-sm"
                    value={params[parameter.name] ?? ''}
                    onChange={(event) =>
                      setParams((prev) => ({
                        ...prev,
                        [parameter.name]: event.target.value,
                      }))
                    }
                    placeholder={
                      parameter.default !== undefined &&
                      parameter.default !== null
                        ? String(parameter.default)
                        : parameter.required
                          ? 'required'
                          : 'optional'
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {requestErrors.length > 0 && (
            <div className="text-muted-foreground text-xs">
              {requestErrors[0].message}
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </fieldset>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={requestErrors.length > 0 || runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            {runMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {retryRun ? 'Retry' : 'Run'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function coerceParameterValue(type: string, raw: string): unknown {
  switch (type) {
    case 'integer': {
      const n = Number(raw)
      return Number.isInteger(n) ? n : raw
    }
    case 'decimal': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
    case 'boolean':
      if (raw === 'true' || raw === '1') return true
      if (raw === 'false' || raw === '0') return false
      return raw
    default:
      return raw
  }
}

function DatasetVersionPicker({
  dataClient,
  name,
  required,
  value,
  onChange,
}: {
  dataClient: DataClient
  name: string
  required: boolean
  value: string
  onChange: (value: string) => void
}) {
  const [datasetId, setDatasetId] = useState('')
  const datasets = useQuery({
    queryKey: ['pipelines', 'run-datasets'],
    queryFn: () =>
      dataClient.list<{ id: string; name: string }>(
        'datasets',
        '?select=id,name&lifecycle=eq.active&order=name.asc',
      ),
  })
  const versions = useQuery({
    queryKey: ['pipelines', 'run-versions', datasetId],
    queryFn: () =>
      dataClient.list<{ id: string; label: string; created_at: string }>(
        'dataset_versions',
        `?dataset_id=eq.${encodeURIComponent(datasetId)}&order=created_at.desc`,
      ),
    enabled: Boolean(datasetId),
  })
  return (
    <div className="space-y-2">
      <Label>
        {name}
        {required ? ' (required)' : ' (optional)'}
      </Label>
      <Select
        aria-label={`${name} dataset`}
        value={datasetId}
        onChange={(event) => {
          setDatasetId(event.target.value)
          onChange('')
        }}
      >
        <option value="">Choose a dataset…</option>
        {datasets.data?.map((dataset) => (
          <option key={dataset.id} value={dataset.id}>
            {dataset.name}
          </option>
        ))}
      </Select>
      {datasetId ? (
        <Select
          aria-label={`${name} version`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose a saved version…</option>
          {versions.data?.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label} · {version.created_at.slice(0, 10)}
            </option>
          ))}
        </Select>
      ) : value ? (
        <p className="break-all text-xs text-muted-foreground">
          Selected version: {value}
        </p>
      ) : null}
      {datasetId && versions.data?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Save a version of this dataset before running the pipeline.
        </p>
      )}
      {(datasets.isError || versions.isError) && (
        <p role="alert" className="text-xs text-destructive">
          Could not load dataset choices. Close and reopen to try again.
        </p>
      )}
    </div>
  )
}
