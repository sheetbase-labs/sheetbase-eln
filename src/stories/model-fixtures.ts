import type { ModelFieldDefinition } from '#/lib/model-fields'
import type { ModelType } from '#/lib/model-subtypes'
import type { WorkspaceRecordModel } from '#/components/models/models-data'

/**
 * Static model fixtures for the model-area stories: a built-in Experiment
 * model, a "Cell culture" subtype of it with its own fields, and a workspace
 * "Cell bank" model. Nothing here is read from a server.
 */
export const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
export const CELL_BANK_ID = '10000000-0000-4000-8000-000000000001'

export function modelField(
  modelKey: string,
  fieldName: string,
  label: string,
  overrides: Partial<ModelFieldDefinition> = {},
): ModelFieldDefinition {
  return {
    id: `${modelKey}:${fieldName}`,
    modelKey,
    fieldName,
    label,
    description: null,
    displayOrder: 0,
    section: null,
    showInList: true,
    askOnCreate: true,
    logicalType: 'text',
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

export const experimentFields: ModelFieldDefinition[] = [
  modelField('experiment', 'objective', 'Objective', {
    displayOrder: 0,
    section: 'Design',
  }),
  modelField('experiment', 'temperature_c', 'Temperature', {
    displayOrder: 1,
    section: 'Design',
    logicalType: 'decimal',
    unit: { symbol: '°C' },
  }),
  modelField('experiment', 'old_flag', 'Legacy flag', {
    displayOrder: 2,
    lifecycle: 'retired',
    logicalType: 'boolean',
  }),
]

export const cellCultureFields: ModelFieldDefinition[] = [
  modelField('cell_culture', 'cell_line', 'Cell line', {
    id: 'cc-1',
    nullable: false,
  }),
  modelField('cell_culture', 'passage', 'Passage', {
    id: 'cc-2',
    displayOrder: 1,
    logicalType: 'integer',
  }),
]

export const modelTypes: ModelType[] = [
  {
    id: 'mt-1',
    key: 'cell_culture',
    name: 'Cell culture',
    prefix: 'CC',
    parentKey: 'experiment',
    lifecycle: 'active',
    publishedVersionId: 'ccv-1',
    versionIds: ['ccv-1'],
  },
  {
    id: 'mt-2',
    key: 'perfusion_run',
    name: 'Perfusion run',
    prefix: 'PR',
    parentKey: 'cell_culture',
    lifecycle: 'active',
    publishedVersionId: 'prv-1',
    versionIds: ['prv-1'],
  },
]

export const cellBankModel: WorkspaceRecordModel = {
  id: CELL_BANK_ID,
  workspace_id: WORKSPACE_ID,
  key: 'cell_bank',
  name: 'Cell bank',
  description: 'Frozen cell bank lots and their release readings.',
  identifier_prefix: 'CB',
  lifecycle: 'active',
  current_version: 4,
  created_at: '2026-05-02T09:00:00.000Z',
  updated_at: '2026-09-25T08:30:00.000Z',
}
