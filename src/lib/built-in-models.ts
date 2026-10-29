import { t } from '#/copy'
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
    name: t('library.models.builtIn.experiment.name'),
    plural: t('library.models.builtIn.experiment.plural'),
    idPrefix: 'EXP',
    description: t('library.models.builtIn.experiment.description'),
    host: 'record',
    surface: {
      to: '/experiments',
      label: t('library.models.builtIn.experiment.surface'),
    },
    standardFields: [
      t('library.models.builtIn.fields.id'),
      t('library.models.builtIn.fields.title'),
      t('library.models.builtIn.fields.status'),
      t('library.models.builtIn.fields.project'),
      t('library.models.builtIn.fields.owner'),
      t('library.models.builtIn.fields.reviewer'),
      t('library.models.builtIn.fields.plannedEnd'),
      t('library.models.builtIn.fields.protocol'),
      t('library.models.builtIn.fields.decision'),
      t('library.models.builtIn.fields.tags'),
    ],
  },
  {
    key: 'sample',
    name: t('library.models.builtIn.sample.name'),
    plural: t('library.models.builtIn.sample.plural'),
    idPrefix: 'SMP',
    description: t('library.models.builtIn.sample.description'),
    host: 'record',
    surface: {
      to: '/samples',
      label: t('library.models.builtIn.sample.surface'),
    },
    standardFields: [
      t('library.models.builtIn.fields.id'),
      t('library.models.builtIn.fields.name'),
      t('library.models.builtIn.fields.status'),
      t('library.models.builtIn.fields.project'),
      t('library.models.builtIn.fields.barcode'),
      t('library.models.builtIn.fields.storageLocation'),
      t('library.models.builtIn.fields.parentSample'),
      t('library.models.builtIn.fields.tags'),
    ],
  },
  {
    key: 'material',
    name: t('library.models.builtIn.material.name'),
    plural: t('library.models.builtIn.material.plural'),
    idPrefix: 'MAT',
    description: t('library.models.builtIn.material.description'),
    host: 'record',
    surface: {
      to: '/materials',
      label: t('library.models.builtIn.material.surface'),
    },
    standardFields: [
      t('library.models.builtIn.fields.id'),
      t('library.models.builtIn.fields.name'),
      t('library.models.builtIn.fields.status'),
      t('library.models.builtIn.fields.supplier'),
      t('library.models.builtIn.fields.catalogueNumber'),
      t('library.models.builtIn.fields.lot'),
      t('library.models.builtIn.fields.expiry'),
      t('library.models.builtIn.fields.storageLocation'),
    ],
  },
  {
    key: 'protocol_template',
    name: t('library.models.builtIn.protocol_template.name'),
    plural: t('library.models.builtIn.protocol_template.plural'),
    idPrefix: 'PRT',
    description: t('library.models.builtIn.protocol_template.description'),
    host: 'record',
    surface: {
      to: '/protocols',
      label: t('library.models.builtIn.protocol_template.surface'),
    },
    standardFields: [
      t('library.models.builtIn.fields.id'),
      t('library.models.builtIn.fields.title'),
      t('library.models.builtIn.fields.status'),
      t('library.models.builtIn.fields.version'),
      t('library.models.builtIn.fields.owner'),
      t('library.models.builtIn.fields.steps'),
    ],
  },
  {
    key: 'project',
    name: t('library.models.builtIn.project.name'),
    plural: t('library.models.builtIn.project.plural'),
    idPrefix: 'PRJ',
    description: t('library.models.builtIn.project.description'),
    host: 'project',
    surface: {
      to: '/projects',
      label: t('library.models.builtIn.project.surface'),
    },
    standardFields: [
      t('library.models.builtIn.fields.id'),
      t('library.models.builtIn.fields.name'),
      t('library.models.builtIn.fields.status'),
      t('library.models.builtIn.fields.lead'),
      t('library.models.builtIn.fields.members'),
      t('library.models.builtIn.fields.defaultReviewer'),
    ],
  },
  {
    key: 'instrument',
    name: t('library.models.builtIn.instrument.name'),
    plural: t('library.models.builtIn.instrument.plural'),
    idPrefix: 'INS',
    description: t('library.models.builtIn.instrument.description'),
    host: 'instrument',
    surface: {
      to: '/instruments',
      label: t('library.models.builtIn.instrument.surface'),
    },
    standardFields: [
      t('library.models.builtIn.fields.id'),
      t('library.models.builtIn.fields.name'),
      t('library.models.builtIn.fields.manufacturer'),
      t('library.models.builtIn.fields.model'),
      t('library.models.builtIn.fields.serial'),
      t('library.models.builtIn.fields.location'),
      t('library.models.builtIn.fields.owner'),
      t('library.models.builtIn.fields.qualifiedFor'),
      t('library.models.builtIn.fields.calibrationDue'),
    ],
  },
]

export function builtInModel(key: string): BuiltInModel | undefined {
  return BUILT_IN_MODELS.find((model) => model.key === key)
}

/** A model the code names directly, so its absence is a programming error. */
export function requireBuiltInModel(key: string): BuiltInModel {
  const model = builtInModel(key)
  if (!model)
    throw new Error(t('library.models.shared.unknownBuiltInModel', { key }))
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
  /** The subtype version the object is pinned to, if it has a subtype. */
  modelVersionId: string | null
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
    model.host === 'record'
      ? 'custom_fields,locked_at,model_version_id'
      : 'custom_fields,model_version_id'
  const row = (
    await client.list<{
      custom_fields: Record<string, unknown> | null
      locked_at?: string | null
      model_version_id: string | null
    }>(
      hostTable[model.host],
      `?id=eq.${encodeURIComponent(objectId)}&select=${select}`,
    )
  ).at(0)
  if (!row) throw new Error('Not found.')
  return {
    customFields: row.custom_fields ?? {},
    locked: Boolean(row.locked_at),
    modelVersionId: row.model_version_id,
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
