import type {
  AnalysisDefinition,
  ANALYSIS_KINDS,
} from '#/lib/analysis-definition'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import type { DefinitionPatch } from './analysis-controls'

export interface DefinitionDraft {
  editingId: string | null
  name: string
  definition: AnalysisDefinition | null
}

export const emptyDraft: DefinitionDraft = {
  editingId: null,
  name: '',
  definition: null,
}

export function patchDefinitionDraft(
  draft: DefinitionDraft,
  patch: DefinitionPatch,
): DefinitionDraft {
  if (!draft.definition) return draft

  if (draft.definition.kind === 'comparison') {
    const definition = { ...draft.definition, ...patch }

    return {
      ...draft,
      definition: {
        ...definition,
        group: definition.group ?? draft.definition.group,
      },
    }
  }

  return { ...draft, definition: { ...draft.definition, ...patch } }
}

/** Field defaults belong to the examined schema, including a snapshot's pin. */
export function startDefinitionDraft({
  kind,
  source,
  snapshotId,
}: {
  kind: (typeof ANALYSIS_KINDS)[number]
  source: CanonicalDatasetSource
  snapshotId: string | null
}): DefinitionDraft {
  const numeric = source.columns.filter((column) =>
    ['decimal', 'integer'].includes(column.logicalType),
  )

  const category = source.columns.filter((column) =>
    ['category', 'text', 'boolean'].includes(column.logicalType),
  )

  const bind = (column?: { id: string }) =>
    column ? { fieldId: column.id } : null

  const first = numeric[0]

  const base = {
    definitionVersion: 1 as const,
    datasets: [
      {
        datasetId: source.datasetId,
        datasetVersionId: snapshotId ?? undefined,
      },
    ],
  }

  const definition: AnalysisDefinition =
    kind === 'descriptive'
      ? { ...base, kind, value: bind(first)!, group: bind(category[0]) }
      : kind === 'curve'
        ? {
            ...base,
            kind,
            dose: bind(first)!,
            response: bind(numeric[1] ?? first)!,
            model: '4pl',
            label: bind(category[0]),
          }
        : kind === 'comparison'
          ? {
              ...base,
              kind,
              value: bind(first)!,
              group: bind(category[0])!,
              test: 'welch',
            }
          : kind === 'survival'
            ? {
                ...base,
                kind,
                time: bind(first)!,
                event: bind(numeric[1] ?? first)!,
                group: bind(category[0]),
              }
            : {
                ...base,
                kind,
                outcome: bind(numeric[1] ?? first)!,
                predictor: bind(first)!,
                degree: 1,
              }

  return { editingId: null, name: '', definition }
}
