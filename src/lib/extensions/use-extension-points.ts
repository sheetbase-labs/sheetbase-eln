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

import { sciDataClient } from '#/lib/chart-data'
import { extensionQueryKeys, listExtensions } from './client'
import { resolveRunnerPoints } from './runner-points'
import type { ResolvedRunnerPoints } from './runner-points'

export function useExtensionPoints(): ResolvedRunnerPoints {
  return useExtensionPointsState().points
}

/** The same, with whether the lookup has finished, for screens that must not guess before it has. */
export function useExtensionPointsState(): {
  points: ResolvedRunnerPoints
  ready: boolean
} {
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

/** The plain-words message from a failed run (`{ error }` from the run routes). */
async function runFailure(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as {
    error?: string
  } | null
  return new Error(body?.error ?? 'The plugin could not run.')
}

/** Runs an operation, calculator or pipeline step by name, as the signed-in person. */
export async function runPluginCallable(args: {
  extensionKey: string
  itemId: string
  input: Record<string, unknown>
}): Promise<{ output: Record<string, unknown>; durationMs: number }> {
  const response = await fetch('/api/plugins/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'operation',
      extensionKey: args.extensionKey,
      operationId: args.itemId,
      input: args.input,
    }),
  })
  if (!response.ok) throw await runFailure(response)
  return (await response.json()) as {
    output: Record<string, unknown>
    durationMs: number
  }
}

export { runFailure }
