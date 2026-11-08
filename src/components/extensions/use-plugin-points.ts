/**
 * The plugin points available to the signed-in person right now: blocks,
 * panels, table cell displays, columns, row actions and field types, from every
 * enabled plugin whose point is switched on. Resolved by the same function the
 * server uses, so what is offered here is what the server will run.
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'

import { notebookDataClient } from '#/lib/notebook-data'
import { extensionQueryKeys, listExtensions } from '#/lib/extensions/client'
import { emptyData, resolveRunnerPoints } from '#/lib/extensions/runner-points'
import type { ResolvedRunnerPoints } from '#/lib/extensions/runner-points'

const EMPTY: ResolvedRunnerPoints = {
  operations: [],
  callables: new Map(),
  analysisKinds: [],
  blocks: [],
  panels: [],
  tableCells: [],
  columns: [],
  rowActions: [],
  fieldTypes: [],
  data: emptyData(),
  pages: [],
  settingsPages: [],
  dashboardWidgets: [],
  reportSections: [],
  descriptors: [],
}

export function usePluginPoints(): ResolvedRunnerPoints & {
  isLoading: boolean
  /** Installed plugins by key, to label a block that outlived its plugin. */
  installed: ReadonlyMap<
    string,
    { name: string; enabled: boolean; scopes: readonly string[] }
  >
} {
  const installs = useQuery({
    queryKey: [...extensionQueryKeys.extensions, 'points'],
    queryFn: () => listExtensions(notebookDataClient),
    staleTime: 30_000,
  })
  return React.useMemo(() => {
    const data = installs.data ?? []
    return {
      ...(data.length > 0 ? resolveRunnerPoints(data) : EMPTY),
      isLoading: installs.isLoading,
      installed: new Map(
        data.map((install) => [
          install.key,
          {
            name: install.name,
            enabled: install.status === 'enabled',
            scopes: install.manifest.scopes ?? [],
          },
        ]),
      ),
    }
  }, [installs.data, installs.isLoading])
}

/** What a frame needs to know to confirm a write: each operation's access. */
export function operationAccess(
  points: ResolvedRunnerPoints,
  extensionKey: string,
): Record<string, 'read' | 'write'> {
  return Object.fromEntries(
    points.operations
      .filter((item) => item.extensionKey === extensionKey)
      .map((item) => [item.id, item.declaration.access]),
  )
}
