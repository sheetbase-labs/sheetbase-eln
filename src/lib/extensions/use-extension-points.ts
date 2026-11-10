/**
 * What the plugins installed in this workspace add, for screens that offer it:
 * the calculator tab, the import page, the export menu, file previews, search.
 *
 * One cached lookup (`listExtensions`) feeds every screen, resolved by the same
 * function the server uses, so a switched-off plugin or part vanishes from all
 * of them at once. A failed lookup means no plugin items, never a broken screen.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { sciDataClient } from '#/lib/chart-data'
import { extensionQueryKeys, listExtensions } from './client'
import { runPluginOperation } from './run-client'
import type { PluginHookBody } from './run-client'
import { resolveRunnerPoints } from './runner-points'
import type { ResolvedRunnerPoints } from './runner-points'

/** The plugin items this workspace has, and whether the lookup has finished. */
export interface ExtensionPointsState {
  points: ResolvedRunnerPoints
  ready: boolean
}

/** What an operation asks the plugin, as the runner request carries it. */
type PluginOperationInput = Extract<
  PluginHookBody,
  { kind: 'operation' }
>['input']

/** What an operation answers: the values the plugin declared, and its run time. */
export interface PluginRunAnswer {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the keys are the plugin's own declared outputs, which this app cannot name; they are read by field name and narrowed at each use.
  output: Record<string, unknown>
  durationMs: number
}

export function useExtensionPoints(): ResolvedRunnerPoints {
  return useExtensionPointsState().points
}

/** The same, with whether the lookup has finished, for screens that must not guess before it has. */
export function useExtensionPointsState(): ExtensionPointsState {
  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'points'],
    queryFn: () => listExtensions(sciDataClient),
    staleTime: 30_000,
    retry: false,
  })

  const points = useMemo(
    () => resolveRunnerPoints(installs.data ?? []),
    [installs.data],
  )

  return { points, ready: !installs.isPending }
}

/** The run routes' failure envelope: a sentence a person can read. */
const runFailureBody = z.object({ error: z.string().optional() })

/** The plain-words message from a failed run (`{ error }` from the run routes). */
async function runFailure(response: Response): Promise<Error> {
  const body = runFailureBody.safeParse(await response.json().catch(() => null))

  return new Error(
    (body.success ? body.data.error : undefined) ?? 'The plugin could not run.',
  )
}

/** Runs an operation, calculator or pipeline step by name, as the signed-in person. */
export async function runPluginCallable(args: {
  extensionKey: string
  itemId: string
  input: PluginOperationInput
}): Promise<PluginRunAnswer> {
  return runPluginOperation<PluginRunAnswer>(
    {
      extensionKey: args.extensionKey,
      operationId: args.itemId,
      input: args.input,
    },
    async () => true,
    'The plugin could not run.',
  )
}

export { runFailure }
