import type { DataClient } from '#/lib/data-client'
import { updateRecordModelFieldValues } from '#/lib/model-fields'

/**
 * The built-in models a workspace can add its own fields to. Their standard
 * fields are fixed (pages, reviews and signatures depend on them); added
 * fields live in `record_field_definitions` with `kind` = the model key and
 * their values in the object's `custom_fields`. Core infrastructure (people,
 * workspaces, sign-in, audit, reviews, signatures) is deliberately absent.
 */
export type BuiltInModelHost = 'record' | 'project' | 'instrument'

export type BuiltInModelSurface =
  | '/experiments'
  | '/samples'
  | '/materials'
  | '/protocols'
  | '/projects'
  | '/instruments'

export interface BuiltInModel {
  key: string
  name: string
  /** Lower-case plural for counts and copy: "experiments". */
  plural: string
  /** The prefix its IDs carry, for the board's ID column. */
  idPrefix: string
  description: string
  host: BuiltInModelHost
  surface: { to: BuiltInModelSurface; label: string }
  /** What every record of the model already records, in the page's words. */
  standardFields: readonly string[]
}

export const BUILT_IN_MODELS: readonly BuiltInModel[] = [
  {
    key: 'experiment',
    name: 'Experiment',
    plural: 'experiments',
    idPrefix: 'EXP',
    description:
      'A notebook entry with its samples, data, review and sign-off.',
    host: 'record',
    surface: { to: '/experiments', label: 'Experiments' },
    standardFields: [
      'ID',
      'Title',
      'Status',
      'Project',
      'Owner',
      'Reviewer',
      'Planned end',
      'Protocol',
      'Decision',
      'Tags',
    ],
  },
  {
    key: 'sample',
    name: 'Sample',
    plural: 'samples',
    idPrefix: 'SMP',
    description: 'Physical material tracked through storage, use and lineage.',
    host: 'record',
    surface: { to: '/samples', label: 'Samples' },
    standardFields: [
      'ID',
      'Name',
      'Status',
      'Project',
      'Barcode',
      'Storage location',
      'Parent sample',
      'Tags',
    ],
  },
  {
    key: 'material',
    name: 'Material',
    plural: 'materials',
    idPrefix: 'MAT',
    description: 'Reagents and consumables, received and released by lot.',
    host: 'record',
    surface: { to: '/materials', label: 'Materials' },
    standardFields: [
      'ID',
      'Name',
      'Status',
      'Supplier',
      'Catalogue number',
      'Lot',
      'Expiry',
      'Storage location',
    ],
  },
  {
    key: 'protocol_template',
    name: 'Protocol',
    plural: 'protocols',
    idPrefix: 'PRT',
    description: 'A controlled method experiments follow, version by version.',
    host: 'record',
    surface: { to: '/protocols', label: 'Protocols' },
    standardFields: ['ID', 'Title', 'Status', 'Version', 'Owner', 'Steps'],
  },
  {
    key: 'project',
    name: 'Project',
    plural: 'projects',
    idPrefix: 'PRJ',
    description:
      'A programme of work that holds experiments, samples and data.',
    host: 'project',
    surface: { to: '/projects', label: 'Projects' },
    standardFields: [
      'ID',
      'Name',
      'Status',
      'Lead',
      'Members',
      'Default reviewer',
    ],
  },
  {
    key: 'instrument',
    name: 'Instrument',
    plural: 'instruments',
    idPrefix: 'INS',
    description: 'Lab equipment, its calibration and the runs it produces.',
    host: 'instrument',
    surface: { to: '/instruments', label: 'Instruments' },
    standardFields: [
      'ID',
      'Name',
      'Manufacturer',
      'Model',
      'Serial',
      'Location',
      'Owner',
      'Qualified for',
      'Calibration due',
    ],
  },
]

export function builtInModel(key: string): BuiltInModel | undefined {
  return BUILT_IN_MODELS.find((model) => model.key === key)
}

/** A model the code names directly, so its absence is a programming error. */
export function requireBuiltInModel(key: string): BuiltInModel {
  const model = builtInModel(key)
  if (!model) throw new Error(`Unknown built-in model: ${key}`)
  return model
}

/** How many objects the model has, for the board's "Used by" column. */
export function countBuiltInModelObjects(
  client: DataClient,
  model: BuiltInModel,
): Promise<number> {
  if (model.host === 'project')
    return client.count('projects', '?archived_at=is.null')
  if (model.host === 'instrument')
    return client.count('instruments', '?retired_at=is.null')
  return client.count(
    'records',
    `?kind=eq.${encodeURIComponent(model.key)}&deleted_at=is.null`,
  )
}

/**
 * A field key from its label: lower-case words joined by underscores, unique
 * against the model's standard and existing field keys. People only ever see
 * the label; the key just has to be stable and valid.
 */
export function fieldKeyFromLabel(
  label: string,
  taken: ReadonlySet<string>,
): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, 'f_$1')
      .slice(0, 50) || 'field'
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export interface AddedFieldValues {
  customFields: Record<string, unknown>
  locked: boolean
}

const hostTable: Record<BuiltInModelHost, string> = {
  record: 'records',
  project: 'projects',
  instrument: 'instruments',
}

export async function fetchAddedFieldValues(
  client: DataClient,
  model: BuiltInModel,
  objectId: string,
): Promise<AddedFieldValues> {
  const select =
    model.host === 'record' ? 'custom_fields,locked_at' : 'custom_fields'
  const row = (
    await client.list<{
      custom_fields: Record<string, unknown> | null
      locked_at?: string | null
    }>(
      hostTable[model.host],
      `?id=eq.${encodeURIComponent(objectId)}&select=${select}`,
    )
  ).at(0)
  if (!row) throw new Error('Not found.')
  return {
    customFields: row.custom_fields ?? {},
    locked: Boolean(row.locked_at),
  }
}

/**
 * Write added-field values onto one object. Records go through
 * `update_record_custom_fields` (history, lock and concurrency checks);
 * projects and instruments merge into `custom_fields` under row security.
 * The database validates every value against the field definitions.
 */
export async function saveAddedFieldValues(
  client: DataClient,
  model: BuiltInModel,
  objectId: string,
  values: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(values).length === 0) return
  if (model.host === 'record') {
    const current = (
      await client.list<{ metadata_version: number; locked_at: string | null }>(
        'records',
        `?id=eq.${encodeURIComponent(objectId)}&select=metadata_version,locked_at`,
      )
    ).at(0)
    if (!current) throw new Error('Not found.')
    if (current.locked_at)
      throw Object.assign(new Error('locked'), { code: 'SB011' })
    await updateRecordModelFieldValues(
      client,
      objectId,
      current.metadata_version,
      values,
    )
    return
  }
  const { customFields } = await fetchAddedFieldValues(client, model, objectId)
  await client.patch(
    hostTable[model.host],
    `?id=eq.${encodeURIComponent(objectId)}`,
    { custom_fields: { ...customFields, ...values } },
  )
}
