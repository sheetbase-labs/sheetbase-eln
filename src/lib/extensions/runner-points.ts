/**
 * Which plugin work is available right now.
 *
 * Operations and analysis kinds a plugin declares only exist while the plugin
 * is enabled and the administrator has not switched that point off. Everything
 * else resolves to nothing, never to an error, so disabling or removing a
 * plugin removes each one cleanly.
 *
 * Pure and browser-safe: the server runtime (`runtime.server.ts`) calls the
 * same resolver before it runs anything, so what a person sees and what the
 * server allows can never disagree.
 */
import type { OperationDescriptor } from '../operations/descriptor'
import type {
  ExtensionBlockDeclaration,
  ExtensionColumnDeclaration,
  ExtensionFieldTypeDeclaration,
  ExtensionPanelDeclaration,
  ExtensionRowActionDeclaration,
  ExtensionTableCellDeclaration,
} from './hooks'
import { parseExtensionManifest } from './manifest'
import { callableItems } from './callables'
import type { CallableItem } from './callables'
import type {
  ExtensionDataContributions,
  ExtensionRecordHookDeclaration,
} from './data-points'
import type {
  ExtensionUiDeclaration,
  ExtensionWidgetDeclaration,
} from './ui-points'
import { pluginOperationDescriptors } from './operation-descriptors'
import { isRunnerPoint, parsePluginName, pluginOperationName } from './points'
import type {
  ExtensionAnalysisKindDeclaration,
  ExtensionOperationDeclaration,
  ExtensionRunnerPoint,
} from './points'

/** The part of an install the resolver needs. Accepts `ExtensionWire`. */
export interface RunnerInstallLike {
  id: string
  key: string
  name?: string
  status: string
  manifest: unknown
  disabled_points?: readonly string[] | null
}

export interface RunnerItem<TDeclaration> {
  extensionId: string
  extensionKey: string
  extensionName: string
  manifestId: string
  manifestVersion: string
  point: ExtensionRunnerPoint
  /** Declaration id, unique within the plugin and point. */
  id: string
  /** `plugin.<key>.<id>`, the name a pipeline step, the assistant or MCP uses. */
  name: string
  declaration: TDeclaration
}

/** The points whose items the app looks up by what they do, not by name. */
export const DATA_ITEM_POINTS = [
  'checks',
  'search-providers',
  'connectors',
  'publishers',
  'notification-channels',
  'importers',
  'exporters',
  'previews',
  'sameness-keys',
  'event-hooks',
  'record-hooks',
  'instrument-parsers',
  'label-formats',
  'barcode-formats',
  'storage-rules',
] as const

export type DataItemPoint = (typeof DATA_ITEM_POINTS)[number]

type DataDeclaration<TPoint extends DataItemPoint> = NonNullable<
  ExtensionDataContributions[TPoint]
>[number]

export interface ResolvedRunnerPoints {
  /** Everything called by name: operations, calculators and pipeline steps. */
  operations: Array<RunnerItem<ExtensionOperationDeclaration>>
  /** Which of those each is, by item name. */
  callables: Map<string, CallableItem>
  analysisKinds: Array<RunnerItem<ExtensionAnalysisKindDeclaration>>
  blocks: Array<RunnerItem<ExtensionBlockDeclaration>>
  /** Panels that bring a screen or a UI bundle; the older plain panels stay with the sample. */
  panels: Array<RunnerItem<ExtensionPanelDeclaration>>
  tableCells: Array<RunnerItem<ExtensionTableCellDeclaration>>
  columns: Array<RunnerItem<ExtensionColumnDeclaration>>
  rowActions: Array<RunnerItem<ExtensionRowActionDeclaration>>
  fieldTypes: Array<RunnerItem<ExtensionFieldTypeDeclaration>>
  /** The other data and search points, by point. */
  data: { [P in DataItemPoint]: Array<RunnerItem<DataDeclaration<P>>> }
  /** Sidebar pages, settings pages, Home widgets and report sections: screens a plugin draws itself. */
  pages: Array<RunnerItem<ExtensionUiDeclaration>>
  settingsPages: Array<RunnerItem<ExtensionUiDeclaration>>
  dashboardWidgets: Array<RunnerItem<ExtensionWidgetDeclaration>>
  reportSections: Array<RunnerItem<ExtensionUiDeclaration>>
  /** The generated descriptors of `operations`, ready for the surface generators. */
  descriptors: OperationDescriptor[]
}

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

export function emptyData(): ResolvedRunnerPoints['data'] {
  return {
    checks: [],
    'search-providers': [],
    connectors: [],
    publishers: [],
    'notification-channels': [],
    importers: [],
    exporters: [],
    previews: [],
    'sameness-keys': [],
    'event-hooks': [],
    'record-hooks': [],
    'instrument-parsers': [],
    'label-formats': [],
    'barcode-formats': [],
    'storage-rules': [],
  }
}

export function resolveRunnerPoints(
  installs: readonly RunnerInstallLike[],
): ResolvedRunnerPoints {
  const out: ResolvedRunnerPoints = {
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

  for (const install of installs) {
    if (install.status !== 'enabled') continue
    let manifest

    try {
      manifest = parseExtensionManifest(install.manifest)
    } catch {
      continue
    }

    const off = new Set(install.disabled_points ?? [])

    const base = {
      extensionId: install.id,
      extensionKey: install.key,
      extensionName: install.name ?? manifest.name,
      manifestId: manifest.id,
      manifestVersion: manifest.version,
    }

    const live = callableItems(manifest).filter((item) => !off.has(item.point))

    for (const item of live) {
      const name = pluginOperationName(install.key, item.id)
      out.operations.push({
        ...base,
        point: item.point,
        id: item.id,
        name,
        declaration: item.declaration,
      })
      out.callables.set(name, item)
    }

    if (live.length) {
      const liveIds = new Set(live.map((item) => item.id))
      out.descriptors.push(
        ...pluginOperationDescriptors(install.key, manifest, {
          pluginName: base.extensionName,
        }).filter((descriptor) =>
          liveIds.has(parsePluginName(descriptor.name)?.id ?? ''),
        ),
      )
    }

    if (!off.has('analysis-kinds')) {
      for (const declaration of manifest.contributions['analysis-kinds'] ??
        []) {
        out.analysisKinds.push({
          ...base,
          point: 'analysis-kinds',
          id: declaration.id,
          name: pluginOperationName(install.key, declaration.id),
          declaration,
        })
      }
    }

    const resolve = <T extends { id: string }>(
      point: ExtensionRunnerPoint,
      declarations: T[] | undefined,
    ): Array<RunnerItem<T>> => {
      if (off.has(point)) return []

      return (declarations ?? [])
        .filter((declaration) => {
          // A plain panel (no screen, no bundle) belongs to the older sample slot.
          return (
            point !== 'panels' || 'screen' in declaration || 'ui' in declaration
          )
        })
        .map((declaration) => ({
          ...base,
          point,
          id: declaration.id,
          name: pluginOperationName(install.key, declaration.id),
          declaration,
        }))
    }

    const c = manifest.contributions
    out.blocks.push(...resolve('blocks', c.blocks))
    out.panels.push(...resolve('panels', c.panels))
    out.tableCells.push(...resolve('table-cells', c['table-cells']))
    out.columns.push(...resolve('columns', c.columns))
    out.rowActions.push(...resolve('row-actions', c['row-actions']))
    out.fieldTypes.push(...resolve('field-types', c['field-types']))
    out.pages.push(...resolve('pages', c.pages))
    out.settingsPages.push(...resolve('settings-pages', c['settings-pages']))
    out.dashboardWidgets.push(
      ...resolve('dashboard-widgets', c['dashboard-widgets']),
    )
    out.reportSections.push(...resolve('report-sections', c['report-sections']))

    const appendData = <P extends DataItemPoint>(point: P) => {
      out.data[point].push(...resolve(point, c[point]))
    }

    for (const point of DATA_ITEM_POINTS) appendData(point)
  }

  out.operations.sort(byName)
  out.analysisKinds.sort(byName)

  for (const group of [
    out.blocks,
    out.panels,
    out.tableCells,
    out.columns,
    out.rowActions,
    out.fieldTypes,
    out.pages,
    out.settingsPages,
    out.dashboardWidgets,
    out.reportSections,
  ])
    group.sort(byName)
  out.descriptors.sort(byName)

  for (const point of DATA_ITEM_POINTS) out.data[point].sort(byName)

  return out
}

/** How an item is labelled in the administrator's list: a key of `plugins.admin.access`. */
export type ExtensionAddDetail =
  | 'read'
  | 'write'
  | 'analysis'
  | 'step'
  | 'calculator'
  | 'check'
  | 'search'
  | 'connector'
  | 'publisher'
  | 'channel'
  | 'import'
  | 'export'
  | 'preview'
  | 'key'
  | 'hook'
  | 'before'
  | 'after'

/** What a manifest adds, point by point, for the administrator's list. */
export interface ExtensionAdds {
  point: ExtensionRunnerPoint
  items: Array<{ id: string; title: string; detail: string }>
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Administrator previews receive raw uploaded manifests; parseExtensionManifest rejects malformed declarations before any items are described.
export function describeRunnerAdds(manifest: unknown): ExtensionAdds[] {
  let parsed

  try {
    parsed = parseExtensionManifest(manifest)
  } catch {
    return []
  }

  const adds: ExtensionAdds[] = []
  const c = parsed.contributions

  const add = <T extends { id: string; title: string }>(
    point: ExtensionRunnerPoint,
    items: T[] | undefined,
    detail: (item: T) => string,
  ) => {
    if (items?.length)
      adds.push({
        point,
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          detail: detail(item),
        })),
      })
  }

  const hookItems = (
    point: ExtensionRunnerPoint,
    items: Array<{ id: string; title: string }> | undefined,
    detail: string,
  ) => {
    if (items?.length)
      adds.push({
        point,
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          detail,
        })),
      })
  }

  hookItems('blocks', parsed.contributions.blocks, 'block')
  hookItems(
    'panels',
    parsed.contributions.panels?.filter((p) => p.screen || p.ui),
    'panel',
  )
  hookItems('table-cells', parsed.contributions['table-cells'], 'cells')
  hookItems('columns', parsed.contributions.columns, 'column')
  hookItems('row-actions', parsed.contributions['row-actions'], 'rows')
  hookItems('field-types', parsed.contributions['field-types'], 'fieldType')
  add(
    'operations',
    c.operations,
    (o: ExtensionOperationDeclaration) => o.access,
  )
  add('analysis-kinds', c['analysis-kinds'], () => 'analysis')
  add('pipeline-steps', c['pipeline-steps'], () => 'step')
  add('calculators', c.calculators, () => 'calculator')
  add('checks', c.checks, () => 'check')
  add('search-providers', c['search-providers'], () => 'search')
  add('connectors', c.connectors, () => 'connector')
  add('publishers', c.publishers, () => 'publisher')
  add('notification-channels', c['notification-channels'], () => 'channel')
  add('importers', c.importers, () => 'import')
  add('exporters', c.exporters, () => 'export')
  add('previews', c.previews, () => 'preview')
  add('sameness-keys', c['sameness-keys'], () => 'key')
  add('event-hooks', c['event-hooks'], () => 'hook')
  add(
    'record-hooks',
    c['record-hooks'],
    (h: ExtensionRecordHookDeclaration) => h.timing,
  )
  add('instrument-parsers', c['instrument-parsers'], () => 'parser')
  add('label-formats', c['label-formats'], () => 'label')
  add('barcode-formats', c['barcode-formats'], () => 'barcode')
  add('storage-rules', c['storage-rules'], () => 'storage')
  hookItems('pages', parsed.contributions.pages, 'page')
  hookItems(
    'settings-pages',
    parsed.contributions['settings-pages'],
    'settings',
  )
  hookItems(
    'dashboard-widgets',
    parsed.contributions['dashboard-widgets'],
    'widget',
  )
  hookItems(
    'report-sections',
    parsed.contributions['report-sections'],
    'section',
  )

  return adds
}

export { isRunnerPoint }
