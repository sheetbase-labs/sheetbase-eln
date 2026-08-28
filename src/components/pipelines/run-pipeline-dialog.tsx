/**
 * AUTO-03 — run a published Pipeline version: supply explicit Dataset
 * Version inputs and typed parameters. The run is started through the
 * governed RPC (digest idempotency) and then executed server-side.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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

export function RunPipelineDialog({
  dataClient,
  workspaceId,
  definitionVersionId,
  config,
  open,
  onOpenChange,
  onRunStarted,
  retryOfRunId = null,
  initialInputVersions,
}: {
  dataClient: DataClient
  workspaceId: string
  definitionVersionId: string
  config: PipelineConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunStarted: (run: PipelineRunWire) => void
  retryOfRunId?: string | null
  /** Pre-fill input Dataset Version ids (e.g. Dataset → Pipeline integration). */
  initialInputVersions?: Record<string, string>
}) {
  const queryClient = useQueryClient()
  const [inputs, setInputs] = useState<Record<string, string>>(() => ({
    ...(initialInputVersions ?? {}),
  }))
  const [params, setParams] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const resolvedParams = useMemo(() => {
    const result: Record<string, unknown> = {}
    for (const parameter of config.parameters) {
      const raw = params[parameter.name]
      if (raw === '') continue
      result[parameter.name] = coerceParameterValue(parameter.type, raw)
    }
    return result
  }, [params, config.parameters])

  const requestErrors = useMemo(() => {
    const resolvedInputs: Record<string, string> = {}
    for (const input of config.inputs) {
      const value = (inputs[input.name] ?? '').trim()
      if (value) resolvedInputs[input.name] = value
    }
    return validatePipelineRunRequest(config, resolvedParams, resolvedInputs)
  }, [config, inputs, params, resolvedParams])

  const runMutation = useMutation({
    mutationFn: async () => {
      const resolvedInputs: Record<string, string> = {}
      for (const input of config.inputs) {
        const value = (inputs[input.name] ?? '').trim()
        if (value) resolvedInputs[input.name] = value
      }
      const started = await startPipelineRun(dataClient, {
        workspaceId,
        definitionVersionId,
        triggerKind: 'manual',
        parameters: resolvedParams,
        inputVersions: resolvedInputs,
        retryOfRunId,
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
        queryKey: pipelineQueryKeys.runs(definitionVersionId),
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
            {retryOfRunId ? 'Retry Pipeline run' : 'Run Pipeline'}
          </DialogTitle>
          <DialogDescription>
            Explicit inputs and parameters. Identical inputs against the same
            published version replay the prior success.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Inputs (Dataset Version ids)</Label>
            {config.inputs.map((input) => (
              <div key={input.name} className="space-y-1">
                <Label className="font-mono text-xs">{input.name}</Label>
                <Input
                  className="font-mono text-sm"
                  value={inputs[input.name] ?? ''}
                  onChange={(event) =>
                    setInputs((prev) => ({
                      ...prev,
                      [input.name]: event.target.value,
                    }))
                  }
                  placeholder="00000000-0000-4000-8000-000000000000"
                />
              </div>
            ))}
          </div>

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
        </div>

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
            {retryOfRunId ? 'Retry' : 'Run'}
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
