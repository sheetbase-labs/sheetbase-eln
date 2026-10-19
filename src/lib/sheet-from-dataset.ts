/**
 * Opening a dataset in a sheet.
 *
 * A sheet shows a dataset's columns through a published sheet definition that
 * takes a dataset as an input. This lists those definitions and creates the
 * sheet with the dataset bound, so the person lands on a sheet that already
 * holds the data rather than an empty one.
 */
import type { DataClient } from '#/lib/data-client'
import { createSheetInstanceFromDefinition } from '#/lib/sheet-instance-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceState } from '#/lib/sheet-instance'

export interface DatasetSheetOption {
  versionId: string
  definitionId: string
  definitionName: string
  version: number
  /** The definition's dataset input: the sheet binds the chosen dataset to it. */
  datasetParameterId: string
}

interface VersionRow {
  id: string
  definition_id: string
  version: number
  configuration: {
    parameters?: { id: string; type?: { kind?: string } }[]
  } | null
}

/**
 * The newest published version of every active sheet definition that has a
 * dataset input. Definitions without one cannot hold a dataset and are left
 * out, so every option listed will work.
 */
export async function fetchDatasetSheetOptions(
  client: DataClient,
): Promise<DatasetSheetOption[]> {
  const [definitions, versions] = await Promise.all([
    client.list<{ id: string; name: string; lifecycle: string }>(
      'sheet_definitions',
      '?lifecycle=eq.active&select=id,name,lifecycle&order=name.asc',
    ),
    client.list<VersionRow>(
      'sheet_definition_versions',
      '?lifecycle=eq.published&select=id,definition_id,version,configuration&order=version.desc',
    ),
  ])
  const names = new Map(definitions.map((d) => [d.id, d.name]))
  const seen = new Set<string>()
  const options: DatasetSheetOption[] = []
  for (const version of versions) {
    const name = names.get(version.definition_id)
    if (name === undefined || seen.has(version.definition_id)) continue
    seen.add(version.definition_id)
    const parameter = version.configuration?.parameters?.find(
      (p) => p.type?.kind === 'dataset',
    )
    if (!parameter) continue
    options.push({
      versionId: version.id,
      definitionId: version.definition_id,
      definitionName: name,
      version: version.version,
      datasetParameterId: parameter.id,
    })
  }
  return options.sort((a, b) =>
    a.definitionName.localeCompare(b.definitionName),
  )
}

/** The state a sheet starts with before its definition fills in the rest. */
export function startingSheetState(): Omit<SheetInstanceState, 'presentation'> {
  return {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    provenance: { createdFrom: 'definition_version' },
  }
}

export function openDatasetInSheet(
  client: DataClient,
  input: {
    workspaceId: string
    name: string
    option: Pick<DatasetSheetOption, 'versionId' | 'datasetParameterId'>
    datasetId: string
    projectId: string | null
    notebookRecordId?: string | null
  },
): Promise<SheetInstance> {
  return createSheetInstanceFromDefinition(
    {
      workspaceId: input.workspaceId,
      name: input.name.trim() || 'Untitled sheet',
      projectId: input.projectId,
      notebookRecordId: input.notebookRecordId ?? null,
      sourceDefinitionVersionId: input.option.versionId,
      state: startingSheetState(),
      parameterInputs: [
        {
          parameterId: input.option.datasetParameterId,
          kind: 'dataset',
          datasetId: input.datasetId,
        },
      ],
    },
    client,
  )
}
