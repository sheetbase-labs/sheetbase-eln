import { useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
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
  pipelineName: string
  version: PipelineDefinitionVersionWire
  /** Set for a retry: links the new run to the failed one and reuses its inputs. */
  retryOf?: PipelineRunWire
  /**
   * Set to run a failed or cancelled run's inputs and parameters again on a
   * different (newer) version. It is a new run, not a retry: the server only
   * links a retry to the exact version it failed on.
   */
  rerunOn?: PipelineRunWire
  /**
   * Values to start the "Run with…" dialog from, e.g. the snapshot of the
   * dataset the person launched from. The dialog still opens so they can check
   * them before anything runs.
   */
  initial?: Partial<RunDetails>
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
            toast.error(t('data.useRunLauncher.runStartedButCould'), {
              description: error.message,
            })
        },
      ),
    onSuccess: (started, { target: launch }) => {
      void refresh()
      setTarget(null)
      toast(
        launch.retryOf
          ? t('data.useRunLauncher.retryStarted', {
              pipelineName: launch.pipelineName,
            })
          : launch.rerunOn
            ? t('data.useRunLauncher.runStartedVersion', {
                pipelineName: launch.pipelineName,
                value: String(launch.version.version),
              })
            : t('data.useRunLauncher.runStarted', {
                pipelineName: launch.pipelineName,
              }),
        {
          description: t('data.useRunLauncher.runningNowOpenRun'),
        },
      )
      onStarted?.(started)
    },
    onError: (error: unknown) => {
      toast(t('data.useRunLauncher.couldStartRun'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.useRunLauncher.databaseRefused'),
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
      pipelineName={target.pipelineName}
      version={target.version}
      initial={target.initial}
      busy={start.isPending}
      onClose={() => setTarget(null)}
      onSubmit={(details) => start.mutate({ target, details })}
    />
  ) : null

  return { launch, pending: start.isPending, dialog }
}
