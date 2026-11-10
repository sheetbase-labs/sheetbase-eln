/**
 * Same-thing rules from plugins for registry models (migration
 * registry_sameness_rules). The plugin turns an entry's fields into a key; the
 * database keeps the key and warns before a repeat is added.
 */
import type { DataClient } from './data-client'
import type { ModelFieldRecordValues } from './model-fields'
import { listExtensions } from './extensions/client'
import { runSamenessKey } from './extensions/plugin-files'
import type { ExtensionField } from './extensions/points'
import { resolveRunnerPoints } from './extensions/runner-points'

export const samenessKeys = {
  rule: (modelKey: string) => ['registry', 'sameness-rule', modelKey] as const,
  matches: (parts: readonly unknown[]) =>
    ['registry', 'sameness-matches', ...parts] as const,
}

export async function getSamenessRule(
  client: DataClient,
  modelKey: string,
): Promise<string | null> {
  const rows = await client.list<{ plugin_item: string }>(
    'registry_sameness_rules',
    `?select=plugin_item&model_key=eq.${encodeURIComponent(modelKey)}`,
  )

  return rows[0]?.plugin_item ?? null
}

export async function setSamenessRule(
  client: DataClient,
  modelKey: string,
  pluginItem: string | null,
): Promise<void> {
  await client.rpc('set_registry_sameness_rule', {
    p_model_key: modelKey,
    p_plugin_item: pluginItem,
  })
}

export interface SamenessMatch {
  id: string
  identifier: string
  title: string
  archived: boolean
  match: 'exact'
}

export async function samenessMatches(
  client: DataClient,
  input: { modelKey: string; value: string; excludeId?: string | null },
): Promise<SamenessMatch[]> {
  return client.rpc<SamenessMatch[]>('registry_sameness_matches', {
    p_model_key: input.modelKey,
    p_value: input.value,
    p_exclude_id: input.excludeId ?? null,
  })
}

export async function setSamenessValue(
  client: DataClient,
  input: { recordId: string; value: string; allowDuplicate: boolean },
): Promise<void> {
  await client.rpc('set_registry_sameness_value', {
    p_record_id: input.recordId,
    p_value: input.value,
    p_allow_duplicate: input.allowDuplicate,
  })
}

/** A record's custom-field values, as the model owner stores them. */
type CustomFieldValues = ModelFieldRecordValues['customFields']

/** What a rule reads from a record, and which required fields it could not find. */
export interface SamenessInputs {
  values: CustomFieldValues
  missing: string[]
}

/**
 * What a rule reads: each declared input is taken from the model field of the
 * same name (ignoring case). The title is offered as `title`.
 */
export function samenessInputs(
  declared: readonly ExtensionField[],
  title: string,
  customFields: CustomFieldValues,
): SamenessInputs {
  const byName = new Map(
    Object.entries(customFields).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  )

  const values: CustomFieldValues = {}
  const missing: string[] = []

  for (const field of declared) {
    const name = field.name.toLowerCase()
    const value = name === 'title' ? title : byName.get(name)

    if (value === undefined || value === null || value === '') {
      if (field.required) missing.push(field.label ?? field.name)
      continue
    }

    values[field.name] = value
  }

  return { values, missing }
}

/**
 * The key a model's plugin rule gives for an entry about to be added, or null
 * when the model has no rule. Every way of adding an entry (the screen, an
 * import, the assistant) uses this, because the database only takes entries of
 * such a model with a key.
 */
export async function samenessKeyFor(
  client: DataClient,
  input: {
    modelKey: string
    title: string
    customFields: CustomFieldValues
  },
): Promise<string | null> {
  const ruleName = await getSamenessRule(client, input.modelKey)

  if (!ruleName) return null
  const installs = await listExtensions(client)

  const rule = resolveRunnerPoints(installs).data['sameness-keys'].find(
    (item) => item.name === ruleName,
  )

  if (!rule)
    throw new Error(
      'This registry uses a same-thing rule from a plugin that is not switched on. Switch the plugin on, or choose another rule in the model’s registry settings.',
    )

  const inputs = samenessInputs(
    rule.declaration.fields,
    input.title,
    input.customFields,
  )

  if (inputs.missing.length > 0)
    throw new Error(
      `The same-thing rule needs ${inputs.missing.join(', ')}. Fill it in to add this entry.`,
    )

  return runSamenessKey({
    extensionKey: rule.extensionKey,
    keyId: rule.id,
    values: inputs.values,
  })
}
