/**
 * Moving a lab's compound registries onto the Chemistry plugin.
 *
 * Before the plugin, a registry model named its structure field in
 * `registry_structure_field` and Sheetbase itself kept a fingerprint and a
 * parent code for each entry. With the plugin, that field is a plugin field
 * type (the drawing input and the picture in tables), the model's same-thing
 * rule is the plugin's "same parent structure" rule, and each entry's key is
 * kept so a repeat is still caught. Nothing about an entry's own fields
 * changes: the molfile stays where it was. The model keeps its structure field and lot model settings, which the lot actions read.
 *
 * Needs the plugin installed and switched on, and an administrator.
 */
import type { DataClient } from './data-client'
import { setSamenessRule, setSamenessValue } from './registry-sameness'

export const CHEMISTRY_PLUGIN_KEY = 'chemistry'
export const CHEMISTRY_FIELD_TYPE = 'structure'
export const CHEMISTRY_RULE = `plugin.${CHEMISTRY_PLUGIN_KEY}.parent-structure`

const PAGE = 500
const WORKERS = 6

export interface AdoptedModel {
  modelKey: string
  structureField: string
  /** Entries given a same-thing key. */
  keyed: number
  /** Entries without a readable structure, left without a key. */
  skipped: number
}

interface ModelRow {
  key: string
  registry_structure_field: string
}

interface EntryRow {
  id: string
  custom_fields: Record<string, unknown> | null
}

async function entriesOf(
  client: DataClient,
  modelKey: string,
): Promise<EntryRow[]> {
  const rows: EntryRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.list<EntryRow>(
      'records',
      `?select=id,custom_fields&kind=eq.${encodeURIComponent(modelKey)}` +
        `&deleted_at=is.null&order=created_at.asc&limit=${PAGE}&offset=${offset}`,
    )
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/** Runs `work` over `items` a few at a time. */
async function inParallel<T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(WORKERS, items.length) }, async () => {
      while (next < items.length) await work(items[next++])
    }),
  )
}

/** Models that still name a structure field the old way. */
export async function modelsToAdopt(client: DataClient): Promise<ModelRow[]> {
  return client.list<ModelRow>(
    'record_models',
    '?select=key,registry_structure_field&registry_structure_field=not.is.null',
  )
}

/** Works out the same-thing key of one structure with the plugin's rule. */
export type KeyFor = (molfile: string) => Promise<string>

export async function adoptChemistryPlugin(
  client: DataClient,
  keyFor: KeyFor,
): Promise<AdoptedModel[]> {
  const adopted: AdoptedModel[] = []
  for (const model of await modelsToAdopt(client)) {
    await client.rpc('set_field_plugin_type', {
      p_kind: model.key,
      p_field_name: model.registry_structure_field,
      p_plugin_key: CHEMISTRY_PLUGIN_KEY,
      p_type_id: CHEMISTRY_FIELD_TYPE,
    })
    await setSamenessRule(client, model.key, CHEMISTRY_RULE)
    const entries = await entriesOf(client, model.key)
    let keyed = 0
    let skipped = 0
    await inParallel(entries, async (entry) => {
      const molfile = entry.custom_fields?.[model.registry_structure_field]
      if (typeof molfile !== 'string' || !molfile.trim()) {
        skipped++
        return
      }
      try {
        const key = await keyFor(molfile)
        // Entries that were already registered keep their place even if two of
        // them share a parent: the old registry allowed that on purpose.
        await setSamenessValue(client, {
          recordId: entry.id,
          value: key,
          allowDuplicate: true,
        })
        keyed++
      } catch {
        skipped++
      }
    })
    adopted.push({
      modelKey: model.key,
      structureField: model.registry_structure_field,
      keyed,
      skipped,
    })
  }
  return adopted
}
