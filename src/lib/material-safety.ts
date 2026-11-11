/**
 * Chemical safety on materials (migration 0062): GHS hazard pictograms, a signal
 * word, hazard statements and a safety data sheet (SDS) file.
 *
 * Reads go straight to `api.material_safety` under row-level security, so anyone
 * who can see a material can see its hazards. Changes go through RPCs, which also
 * apply them to the other lots of the same material.
 */
import { t } from '#/copy'
import { en as enCatalogue } from '#/copy/en'
import { listByIds } from '#/lib/chunk-ids'
import type { DataClient } from '#/lib/data-client'
import { z } from 'zod'

export const GHS_PICTOGRAMS = [
  'GHS01',
  'GHS02',
  'GHS03',
  'GHS04',
  'GHS05',
  'GHS06',
  'GHS07',
  'GHS08',
  'GHS09',
] as const

export type GhsPictogram = (typeof GHS_PICTOGRAMS)[number]

export const SIGNAL_WORDS = ['danger', 'warning'] as const

export type SignalWord = (typeof SIGNAL_WORDS)[number]

/** Every hazard statement the catalogue words. */
export type HazardCode = keyof typeof enCatalogue.safety.statements

export function isGhsPictogram(value: string): value is GhsPictogram {
  return GHS_PICTOGRAMS.some((code) => code === value)
}

export function pictogramName(code: GhsPictogram): string {
  return t(`safety.pictograms.${code}`)
}

/** The codes the catalogue words; membership is the catalogue's own evidence. */
const hazardStatementKeys: ReadonlySet<string> = new Set(
  Object.keys(enCatalogue.safety.statements),
)

/** Whether the catalogue words this statement code. */
export function isHazardCode(code: string): code is HazardCode {
  return hazardStatementKeys.has(code)
}

/** The wording of a hazard statement, or the bare code when it has no wording. */
export function hazardStatementText(code: string): string {
  if (!isHazardCode(code)) return code

  const key = `safety.statements.${code}` as const

  try {
    const text = t(key)

    return text === key ? code : text
  } catch {
    return code
  }
}

/** All statement codes the catalogue words, in code order. */
export function knownHazardCodes(): HazardCode[] {
  return [...hazardStatementKeys].filter(isHazardCode)
}

export interface MaterialSafety {
  recordId: string
  pictograms: GhsPictogram[]
  signalWord: SignalWord | null
  hazardStatements: string[]
  sheet: { fileObjectId: string; fileRecordId: string; name: string } | null
  updatedAt: string
}

interface MaterialSafetyWire {
  record_id: string
  pictograms: string[] | null
  signal_word: string | null
  hazard_statements: string[] | null
  sds_file_object_id: string | null
  updated_at: string
  sds: {
    id: string
    record_id: string
    display_name: string
  } | null
}

const SELECT =
  'record_id,pictograms,signal_word,hazard_statements,sds_file_object_id,updated_at,' +
  'sds:file_objects!material_safety_sds_fk(id,record_id,display_name)'

export function toMaterialSafety(row: MaterialSafetyWire): MaterialSafety {
  return {
    recordId: row.record_id,
    pictograms: (row.pictograms ?? []).filter(isGhsPictogram),
    signalWord:
      row.signal_word === 'danger' || row.signal_word === 'warning'
        ? row.signal_word
        : null,
    hazardStatements: row.hazard_statements ?? [],
    sheet: row.sds
      ? {
          fileObjectId: row.sds.id,
          fileRecordId: row.sds.record_id,
          name: row.sds.display_name,
        }
      : null,
    updatedAt: row.updated_at,
  }
}

/** Whether a material has anything to warn about. */
export function isHazardous(safety: MaterialSafety | null | undefined) {
  return Boolean(
    safety &&
    (safety.pictograms.length > 0 ||
      safety.signalWord !== null ||
      safety.hazardStatements.length > 0),
  )
}

export async function fetchMaterialSafety(
  client: DataClient,
  recordId: string,
): Promise<MaterialSafety | null> {
  const rows = await client.list<MaterialSafetyWire>(
    'material_safety',
    `?record_id=eq.${encodeURIComponent(recordId)}&select=${SELECT}&limit=1`,
  )

  const row = rows.at(0)

  return row ? toMaterialSafety(row) : null
}

/** The safety information of several materials, keyed by record id. */
export async function fetchMaterialSafetyFor(
  client: DataClient,
  recordIds: readonly string[],
): Promise<Map<string, MaterialSafety>> {
  if (recordIds.length === 0) return new Map()

  const rows = await listByIds(recordIds, (inList) =>
    client.list<MaterialSafetyWire>(
      'material_safety',
      `?record_id=in.(${inList})&select=${SELECT}`,
    ),
  )

  return new Map(rows.map((row) => [row.record_id, toMaterialSafety(row)]))
}

/** Every material in the workspace that has safety information. */
export async function fetchAllMaterialSafety(
  client: DataClient,
): Promise<Map<string, MaterialSafety>> {
  const rows = await client.list<MaterialSafetyWire>(
    'material_safety',
    `?select=${SELECT}&limit=2000`,
  )

  return new Map(rows.map((row) => [row.record_id, toMaterialSafety(row)]))
}

export function setMaterialSafety(
  client: DataClient,
  input: {
    recordId: string
    pictograms: readonly string[]
    signalWord: SignalWord | null
    hazardStatements: readonly string[]
    allLots: boolean
  },
): Promise<number> {
  return client.rpc<number>('set_material_safety', {
    p_record_id: input.recordId,
    p_pictograms: [...input.pictograms],
    p_signal_word: input.signalWord,
    p_hazard_statements: [...input.hazardStatements],
    p_all_lots: input.allLots,
  })
}

export function setMaterialSds(
  client: DataClient,
  input: {
    recordId: string
    fileObjectId: string | null
    allLots: boolean
  },
): Promise<number> {
  return client.rpc<number>('set_material_sds', {
    p_record_id: input.recordId,
    p_file_object_id: input.fileObjectId,
    p_all_lots: input.allLots,
  })
}

/** A materials block's payload: the material each item names, as the editor stored it. */
const materialsPayloadSchema = z.object({
  items: z
    .array(z.object({ materialRecordId: z.string().nullish() }))
    .nullish(),
})

/**
 * The materials a protocol (or any notebook document) uses: ids from its
 * materials blocks, then from its material links.
 */
export function materialIdsFromBlocks(
  blocks: readonly { type: string; payload: unknown }[],
): string[] {
  const ids: string[] = []

  for (const block of blocks) {
    if (block.type !== 'materials') continue

    const payload = materialsPayloadSchema.safeParse(block.payload)

    if (!payload.success) continue

    for (const item of payload.data.items ?? []) {
      const id = item.materialRecordId

      if (id) ids.push(id)
    }
  }

  return ids
}

export const materialSafetyKeys = {
  one: (recordId: string) => ['material-safety', 'one', recordId] as const,
  all: () => ['material-safety', 'all'] as const,
  many: (ids: readonly string[]) =>
    ['material-safety', 'many', [...ids].sort().join(',')] as const,
}
