import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/v3/ui/sonner'
import { RunDialog } from '#/components/v3/pipelines/run-dialog'
import type { RunDetails } from '#/components/v3/pipelines/run-dialog'
import {
  runNeedsDetails,
  startAndExecuteRun,
} from '#/components/v3/pipelines/pipelines-data'
import type {
  PipelineDefinitionVersionWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'

interface Target {
  pipelineKey: string
  version: PipelineDefinitionVersionWire
  /** Set for a retry: links the new run to the failed one and reuses its inputs. */
  retryOf?: PipelineRunWire
  /**
   * Set to run a failed or cancelled run's inputs and parameters again on a
   * different (newer) version. It is a new run, not a retry: the server only
   * links a retry to the exact version it failed on.
   */
  rerunOn?: PipelineRunWire
}

/**
 * One way to start a run from any Pipelines screen. A version that declares
 * inputs or parameters opens "Run with…" first; any run is then executed, since
 * starting only records it. Returns the dialog to render beside the button.
 */
export function useRunLauncher(
  workspaceId: string,
  onStarted?: (run: PipelineRunWire) => void,
) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<Target | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const start = useMutation({
    mutationFn: (input: { target: Target; details: RunDetails }) =>
      startAndExecuteRun(
        {
          workspaceId,
          definitionVersionId: input.target.version.id,
          triggerKind: 'manual',
          retryOfRunId: input.target.retryOf?.id ?? null,
          inputVersions: input.details.inputVersions,
          parameters: input.details.parameters,
        },
        ({ error }) => {
          void refresh()
          if (error)
            toast.error('The run started but could not finish', {
              description: error.message,
            })
        },
      ),
    onSuccess: (started, { target: t }) => {
      void refresh()
      setTarget(null)
      toast(
        t.retryOf
          ? `Retry of ${t.pipelineKey} started`
          : t.rerunOn
            ? `Run of ${t.pipelineKey} started on version ${String(t.version.version)}`
            : `Run of ${t.pipelineKey} started`,
        {
          description: 'It is running now. Open the run to follow its log.',
        },
      )
      onStarted?.(started)
    },
    onError: (error: unknown) => {
      toast('Could not start the run', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    },
  })

  const launch = (next: Target) => {
    const retried = next.retryOf ?? next.rerunOn
    if (!retried && runNeedsDetails(next.version)) {
      setTarget(next)
      return
    }
    start.mutate({
      target: next,
      details: {
        inputVersions: retried?.input_versions ?? {},
        parameters: retried?.parameters ?? {},
      },
    })
  }

  const dialog: ReactNode = target ? (
    <RunDialog
      pipelineKey={target.pipelineKey}
      version={target.version}
      busy={start.isPending}
      onClose={() => setTarget(null)}
      onSubmit={(details) => start.mutate({ target, details })}
    />
  ) : null

  return { launch, pending: start.isPending, dialog }
}
