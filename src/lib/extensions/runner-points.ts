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
import { pluginOperationDescriptors } from './operation-descriptors'
import { isRunnerPoint, pluginOperationName } from './points'
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

export interface ResolvedRunnerPoints {
  operations: Array<RunnerItem<ExtensionOperationDeclaration>>
  analysisKinds: Array<RunnerItem<ExtensionAnalysisKindDeclaration>>
  blocks: Array<RunnerItem<ExtensionBlockDeclaration>>
  /** Panels that bring a screen or a UI bundle; the older plain panels stay with the sample. */
  panels: Array<RunnerItem<ExtensionPanelDeclaration>>
  tableCells: Array<RunnerItem<ExtensionTableCellDeclaration>>
  columns: Array<RunnerItem<ExtensionColumnDeclaration>>
  rowActions: Array<RunnerItem<ExtensionRowActionDeclaration>>
  fieldTypes: Array<RunnerItem<ExtensionFieldTypeDeclaration>>
  /** The generated descriptors of `operations`, ready for the surface generators. */
  descriptors: OperationDescriptor[]
}

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

export function resolveRunnerPoints(
  installs: readonly RunnerInstallLike[],
): ResolvedRunnerPoints {
  const out: ResolvedRunnerPoints = {
    operations: [],
    analysisKinds: [],
    blocks: [],
    panels: [],
    tableCells: [],
    columns: [],
    rowActions: [],
    fieldTypes: [],
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
    if (!off.has('operations')) {
      for (const declaration of manifest.contributions.operations ?? []) {
        out.operations.push({
          ...base,
          point: 'operations',
          id: declaration.id,
          name: pluginOperationName(install.key, declaration.id),
          declaration,
        })
      }
      out.descriptors.push(
        ...pluginOperationDescriptors(install.key, manifest, {
          pluginName: base.extensionName,
        }),
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
  ])
    (group as Array<{ name: string }>).sort(byName)
  out.descriptors.sort(byName)
  return out
}

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
  const operations = parsed.contributions.operations
  if (operations?.length) {
    adds.push({
      point: 'operations',
      items: operations.map((operation) => ({
        id: operation.id,
        title: operation.title,
        detail: operation.access,
      })),
    })
  }
  const kinds = parsed.contributions['analysis-kinds']
  if (kinds?.length) {
    adds.push({
      point: 'analysis-kinds',
      items: kinds.map((kind) => ({
        id: kind.id,
        title: kind.title,
        detail: 'analysis',
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
  return adds
}

export { isRunnerPoint }
