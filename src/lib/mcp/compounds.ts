/**
 * MCP and assistant reads for chemistry registration: search the registries
 * that take structures by substructure or similarity, and check whether a
 * structure is already registered. The chemistry (OpenChemLib) runs here; the
 * database narrows by fingerprint and keeps the duplicate rule.
 */
import type { DataClient } from '../data-client'
import { loadOcl } from '../chemistry-draw'
import {
  describeStructure,
  findStructureDuplicates,
  searchStructures,
} from '../compound-registry'

export const COMPOUND_SEARCH_TOOL = 'sheetbase.compound.search'
export const COMPOUND_CHECK_TOOL = 'sheetbase.compound.check'

export function isCompoundReadTool(name: string): boolean {
  return name === COMPOUND_SEARCH_TOOL || name === COMPOUND_CHECK_TOOL
}

interface ModelRow {
  key: string
  name: string
}

/** The registry that takes structures, by key or name. */
async function structureRegistries(
  client: DataClient,
  wanted: string | null | undefined,
): Promise<ModelRow[]> {
  const rows = await client.list<ModelRow>(
    'record_models',
    '?is_registry=eq.true&registry_structure_field=not.is.null&select=key,name&order=name.asc',
  )
  if (!wanted) return rows
  const lower = wanted.trim().toLowerCase()
  return rows.filter(
    (row) =>
      row.key.toLowerCase() === lower || row.name.toLowerCase() === lower,
  )
}

export async function callCompoundRead(
  name: string,
  args: Record<string, unknown>,
  client: DataClient,
): Promise<unknown> {
  const ocl = await loadOcl()
  const structure = String(args.structure ?? '')
  if (name === COMPOUND_CHECK_TOOL) {
    const registries = await structureRegistries(
      client,
      typeof args.registry === 'string' ? args.registry : null,
    )
    if (registries.length === 0) {
      return { error: 'No registry that takes structures has that name.' }
    }
    const registry = registries[0]
    const described = describeStructure(ocl, structure)
    if (!described) return { error: 'That could not be read as a structure.' }
    const matches = await findStructureDuplicates(client, {
      kind: registry.key,
      descriptor: described,
    })
    return {
      registry: registry.name,
      parentCode: described.parentCode,
      formula: described.formula,
      mass: described.mass,
      saltsSetAside: described.salts,
      registered: matches.length > 0,
      matches: matches.map((m) => ({
        identifier: m.identifier,
        name: m.title,
        retired: m.archived,
        sameForm: m.sameForm,
      })),
    }
  }
  const registries = await structureRegistries(
    client,
    typeof args.registry === 'string' ? args.registry : null,
  )
  if (typeof args.registry === 'string' && registries.length === 0) {
    return { error: 'No registry that takes structures has that name.' }
  }
  const mode = args.mode === 'similarity' ? 'similarity' : 'substructure'
  const hits = await searchStructures(
    client,
    {
      query: structure,
      mode,
      kind: registries.length === 1 && args.registry ? registries[0].key : null,
      minSimilarity:
        typeof args.minSimilarity === 'number' ? args.minSimilarity : 0.6,
      includeArchived: args.includeRetired === true,
      limit: typeof args.limit === 'number' ? args.limit : 50,
    },
    ocl,
  )
  return {
    mode,
    count: hits.length,
    compounds: hits.map((h) => ({
      identifier: h.identifier,
      name: h.title,
      registry: h.kind,
      formula: h.formula,
      mass: h.mass,
      retired: h.archived,
      ...(mode === 'similarity' ? { similarity: h.similarity } : {}),
    })),
  }
}

const STRUCTURE_WRITES = new Set(['register_compound', 'set_record_structure'])

/**
 * Over MCP a structure can be given as `{"smiles": "…"}` or `{"molfile": "…"}`;
 * this turns it into the description the database keeps (parent code,
 * fingerprint and so on). A description that is already complete passes through.
 */
export async function prepareStructureArguments(
  action: string,
  args: Record<string, unknown>,
): Promise<
  { ok: true; args: Record<string, unknown> } | { ok: false; message: string }
> {
  if (!STRUCTURE_WRITES.has(action)) return { ok: true, args }
  const given = args.p_structure
  if (given === null || typeof given !== 'object' || Array.isArray(given)) {
    return { ok: true, args }
  }
  const structure = given as Record<string, unknown>
  if (typeof structure.parentCode === 'string') return { ok: true, args }
  const source =
    typeof structure.smiles === 'string'
      ? structure.smiles
      : typeof structure.molfile === 'string'
        ? structure.molfile
        : ''
  if (!source) {
    return {
      ok: false,
      message:
        'p_structure needs a smiles or molfile, or the description from POST /api/structures/describe.',
    }
  }
  const described = describeStructure(await loadOcl(), source)
  if (!described) {
    return { ok: false, message: 'That could not be read as a structure.' }
  }
  return { ok: true, args: { ...args, p_structure: described } }
}
