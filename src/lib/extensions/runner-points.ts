/**
 * Which extension work is available right now.
 *
 * Pipeline actions, assistant tools and analysis kinds an extension declares
 * only exist while the extension is enabled and the administrator has not
 * switched that point off. Everything else resolves to nothing, never to an
 * error, so disabling or removing an extension removes each one cleanly.
 *
 * Pure and browser-safe: the server runtime (`runtime.server.ts`) calls the
 * same resolver before it runs anything, so what a person sees and what the
 * server allows can never disagree.
 */
import { parseExtensionManifest } from './manifest'
import {
  extensionOperationName,
  extensionToolName,
  isRunnerPoint,
} from './points'
import type {
  ExtensionAnalysisKindDeclaration,
  ExtensionAssistantToolDeclaration,
  ExtensionPipelineActionDeclaration,
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
  /** Declaration id, unique within the extension and point. */
  id: string
  /** `extension.<key>.<id>`, the name a pipeline step, the assistant or MCP uses. */
  name: string
  declaration: TDeclaration
}

export interface ResolvedRunnerPoints {
  pipelineActions: Array<RunnerItem<ExtensionPipelineActionDeclaration>>
  assistantTools: Array<RunnerItem<ExtensionAssistantToolDeclaration>>
  analysisKinds: Array<RunnerItem<ExtensionAnalysisKindDeclaration>>
}

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

export function resolveRunnerPoints(
  installs: readonly RunnerInstallLike[],
): ResolvedRunnerPoints {
  const out: ResolvedRunnerPoints = {
    pipelineActions: [],
    assistantTools: [],
    analysisKinds: [],
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
    if (!off.has('pipeline-actions')) {
      for (const declaration of manifest.contributions['pipeline-actions'] ??
        []) {
        out.pipelineActions.push({
          ...base,
          point: 'pipeline-actions',
          id: declaration.id,
          name: extensionOperationName(install.key, declaration.id),
          declaration,
        })
      }
    }
    if (!off.has('assistant-tools')) {
      for (const declaration of manifest.contributions['assistant-tools'] ??
        []) {
        out.assistantTools.push({
          ...base,
          point: 'assistant-tools',
          id: declaration.id,
          name: extensionToolName(install.key, declaration.id),
          declaration,
        })
      }
    }
    if (!off.has('analysis-kinds')) {
      for (const declaration of manifest.contributions['analysis-kinds'] ??
        []) {
        out.analysisKinds.push({
          ...base,
          point: 'analysis-kinds',
          id: declaration.id,
          name: `extension.${install.key}.${declaration.id}`,
          declaration,
        })
      }
    }
  }
  out.pipelineActions.sort(byName)
  out.assistantTools.sort(byName)
  out.analysisKinds.sort(byName)
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
  const actions = parsed.contributions['pipeline-actions']
  if (actions?.length) {
    adds.push({
      point: 'pipeline-actions',
      items: actions.map((a) => ({
        id: a.id,
        title: a.title,
        detail: a.runner.kind,
      })),
    })
  }
  const tools = parsed.contributions['assistant-tools']
  if (tools?.length) {
    adds.push({
      point: 'assistant-tools',
      items: tools.map((tool) => ({
        id: tool.id,
        title: tool.title,
        detail: `${tool.access}, ${tool.runner.kind}`,
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
        detail: kind.runner.kind,
      })),
    })
  }
  return adds
}

export { isRunnerPoint }
