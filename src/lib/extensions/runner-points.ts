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
  'importers',
  'exporters',
  'previews',
  'sameness-keys',
  'event-hooks',
  'record-hooks',
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
    importers: [],
    exporters: [],
    previews: [],
    'sameness-keys': [],
    'event-hooks': [],
    'record-hooks': [],
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
    const hooks = [
      ['blocks', out.blocks],
      ['panels', out.panels],
      ['table-cells', out.tableCells],
      ['columns', out.columns],
      ['row-actions', out.rowActions],
      ['field-types', out.fieldTypes],
      ['pages', out.pages],
      ['settings-pages', out.settingsPages],
      ['dashboard-widgets', out.dashboardWidgets],
      ['report-sections', out.reportSections],
    ] as const
    for (const [point, target] of hooks) {
      if (off.has(point)) continue
      const declared = manifest.contributions[point] as
        Array<{ id: string }> | undefined
      for (const declaration of declared ?? []) {
        // A plain panel (no screen, no bundle) belongs to the older sample slot.
        if (
          point === 'panels' &&
          !('screen' in declaration) &&
          !('ui' in declaration)
        )
          continue
        ;(target as Array<RunnerItem<unknown>>).push({
          ...base,
          point,
          id: declaration.id,
          name: pluginOperationName(install.key, declaration.id),
          declaration,
        })
      }
    }
    for (const point of DATA_ITEM_POINTS) {
      if (off.has(point)) continue
      for (const declaration of manifest.contributions[point] ?? []) {
        ;(out.data[point] as Array<RunnerItem<unknown>>).push({
          ...base,
          point,
          id: declaration.id,
          name: pluginOperationName(install.key, declaration.id),
          declaration,
        })
      }
    }
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
    (group as Array<{ name: string }>).sort(byName)
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

export function describeRunnerAdds(manifest: unknown): ExtensionAdds[] {
  let parsed
  try {
    parsed = parseExtensionManifest(manifest)
  } catch {
    return []
  }
  const adds: ExtensionAdds[] = []
  const c = parsed.contributions
  const add = (
    point: ExtensionRunnerPoint,
    items: Array<{ id: string; title: string }> | undefined,
    detail: (item: never) => string,
  ) => {
    if (items?.length)
      adds.push({
        point,
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          detail: detail(item as never),
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
