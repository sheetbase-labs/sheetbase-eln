/**
 * Opening a dataset in a sheet.
 *
 * A sheet shows a dataset's columns through a published sheet definition that
 * takes a dataset as an input. This lists those definitions and creates the
 * sheet with the dataset bound, so the person lands on a sheet that already
 * holds the data rather than an empty one.
 */
import type { DataClient } from '#/lib/data-client'
import {
  createSheetInstanceFromDefinition,
  resolveSheetInstanceRowIdentity,
} from '#/lib/sheet-instance-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceState } from '#/lib/sheet-instance'

export interface DatasetSheetOption {
  versionId: string
  definitionId: string
  definitionName: string
  version: number
  /** The definition's dataset input: the sheet binds the chosen dataset to it. */
  datasetParameterId: string | null
  unavailableReason?: string | null
}

/**
 * The server tests current schema semantics and all required inputs through
 * the same parameter resolver that creates the Sheet Instance.
 */
export async function fetchDatasetSheetOptions(
  client: DataClient,
  datasetId: string,
): Promise<DatasetSheetOption[]> {
  const options = await client.rpc<DatasetSheetOption[]>(
    'dataset_sheet_options',
    {
      p_dataset_id: datasetId,
    },
  )
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

export async function openDatasetInSheet(
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
  if (!input.option.datasetParameterId) {
    throw new Error(
      'This definition cannot open the selected dataset with its required inputs.',
    )
  }
  const instance = await createSheetInstanceFromDefinition(
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
  return resolveSheetInstanceRowIdentity(instance.id, instance.revision, client)
}
