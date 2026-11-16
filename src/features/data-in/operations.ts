/**
 * Open a dataset in a sheet. A sheet shows a dataset through a published sheet
 * definition that takes a dataset as an input. A dataset made from a file has
 * none, so the database writes one from the dataset's own columns the first
 * time (once per measurement table version) and makes the sheet from it. The
 * definition only mirrors columns the dataset already has, so it needs no
 * authoring right: anyone who may edit the notebook or project may open the
 * data in a sheet.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

export const DATA_IN_OPERATIONS = defineOperations([
  {
    name: 'open_dataset_in_sheet',
    label: 'Open a dataset in a sheet',
    summary: 'Open a dataset in a new sheet',
    description:
      'Makes a new sheet that shows every column and row of a dataset, and puts it in a notebook when you name one. No steward-made sheet definition is needed: the columns come from the dataset itself. Returns `{ instance, definitionVersionId, block }`; `block` is the notebook block when a notebook was named.',
    kind: 'write',
    scope: 'datasets:write',
    inputs: [
      note('p_dataset_id', 'uuid', 'The dataset to show.'),
      note(
        'p_name',
        'text',
        'The sheet’s name. Defaults to the dataset’s name.',
        false,
        true,
      ),
      note(
        'p_notebook_record_id',
        'uuid',
        'An experiment or other notebook to put the sheet in.',
        false,
        true,
      ),
      note(
        'p_project_id',
        'uuid',
        'The project the sheet belongs to. Defaults to the notebook’s, then the dataset’s.',
        false,
        true,
      ),
      note(
        'p_after_block_id',
        'uuid',
        'Put the sheet right after this block of the notebook. Defaults to the end.',
        false,
        true,
      ),
    ],
    result: 'json',
    assistant: { tool: 'sheetbase.sheet.open_dataset' },
    pipeline: {},
    docsPage: 'data-in-api.md',
    events: [],
  },
])
