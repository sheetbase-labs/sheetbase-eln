/**
 * Chemistry registration (migration 0104). A registry model can name the field
 * that holds a drawn structure; its entries then carry a duplicate check on the
 * parent structure (salts and solvents stripped), lots, and structure search.
 *
 * The chemistry runs here with OpenChemLib, in the browser or on the server; the
 * database keeps the parent code and a 512-bit fragment fingerprint and narrows
 * searches with it. Nothing but plain Postgres is needed.
 */
import type { Molecule } from 'openchemlib'

import { loadOcl } from '#/lib/chemistry-draw'
import type { Ocl } from '#/lib/chemistry-draw'
import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'

export const compoundKeys = {
  all: ['compounds'] as const,
  search: (parts: readonly unknown[]) =>
    ['compounds', 'search', ...parts] as const,
  duplicates: (parts: readonly unknown[]) =>
    ['compounds', 'duplicates', ...parts] as const,
  lots: (id: string) => ['compounds', 'lots', id] as const,
  structures: (kind: string) => ['compounds', 'structures', kind] as const,
}

/** What the database keeps about a drawn structure. */
export interface StructureDescriptor {
  /** The structure as drawn, as a molfile, kept in the model's structure field. */
  molfile: string
  /** Canonical code of the parent: largest fragment, neutral, salts removed. */
  parentCode: string
  /** Canonical code of the structure as drawn, salts included. */
  drawnCode: string
  formula: string
  /** Average mass of the parent in g/mol. */
  mass: number
  /** What was stripped, as SMILES (a chloride, a sodium, water). */
  salts: string[]
  /** 512-bit fragment index of the parent, as 128 hex digits. */
  fingerprint: string
}

function heavyAtoms(molecule: Molecule): number {
  let count = 0
  for (let atom = 0; atom < molecule.getAllAtoms(); atom++) {
    if (molecule.getAtomicNo(atom) > 1) count++
  }
  return count
}

function isMolfile(text: string): boolean {
  return /\bM {2}END\b|V2000|V3000/.test(text) || text.includes('\n')
}

/** A drawing, a molfile or a SMILES line as a molecule, or null if it is none. */
export function readStructure(ocl: Ocl, text: string): Molecule | null {
  if (!text.trim()) return null
  // A molfile starts with a title line that may be blank: never trim its start.
  const source = isMolfile(text) ? text : text.trim()
  try {
    const molecule = isMolfile(source)
      ? ocl.Molecule.fromMolfile(source)
      : ocl.Molecule.fromSmiles(source)
    if (molecule.getAllAtoms() === 0) return null
    molecule.ensureHelperArrays(ocl.Molecule.cHelperParities)
    return molecule
  } catch {
    return null
  }
}

/** The fingerprint of a molecule or a query, as 128 hex digits. */
export function fingerprintOf(ocl: Ocl, molecule: Molecule): string {
  const searcher = new ocl.SSSearcherWithIndex()
  return ocl.SSSearcherWithIndex.getHexStringFromIndex(
    searcher.createIndex(molecule),
  )
    .toLowerCase()
    .padStart(128, '0')
}

/**
 * Splits a drawing into the compound and what came with it. The parent is the
 * largest piece, charges neutralised where leaving a counter-ion made them;
 * every other piece (chloride, sodium, water, a solvent) is a salt.
 */
export function splitSalts(
  ocl: Ocl,
  molecule: Molecule,
): { parent: Molecule; salts: string[] } {
  const pieces = molecule.getFragments()
  if (pieces.length <= 1)
    return { parent: molecule.getCompactCopy(), salts: [] }
  const ranked = pieces
    .map((piece) => ({ piece, size: heavyAtoms(piece) }))
    .sort((a, b) => b.size - a.size)
  const parent = molecule.getCompactCopy()
  parent.stripSmallFragments(false)
  parent.ensureHelperArrays(ocl.Molecule.cHelperParities)
  const salts = ranked.slice(1).map(({ piece }) => piece.toSmiles())
  return { parent, salts }
}

/** Everything the database needs to know about a drawing, or null if it is blank. */
export function describeStructure(
  ocl: Ocl,
  source: string,
): StructureDescriptor | null {
  const molecule = readStructure(ocl, source)
  if (!molecule) return null
  const { parent, salts } = splitSalts(ocl, molecule)
  const formula = parent.getMolecularFormula()
  let molfile = source
  if (!isMolfile(source)) {
    const drawn = molecule.getCompactCopy()
    drawn.inventCoordinates()
    molfile = drawn.toMolfile()
  }
  return {
    molfile,
    parentCode: parent.getIDCode(),
    drawnCode: molecule.getIDCode(),
    formula: formula.formula,
    mass: Number(formula.relativeWeight.toFixed(3)),
    salts,
    fingerprint: fingerprintOf(ocl, parent),
  }
}

/** Async form for callers that have not loaded the library yet. */
export async function describeStructureAsync(
  source: string,
): Promise<StructureDescriptor | null> {
  return describeStructure(await loadOcl(), source)
}

// Search --------------------------------------------------------------------

export type SearchMode = 'substructure' | 'similarity'

export interface StructureHit {
  recordId: string
  identifier: string
  title: string
  kind: string
  parentCode: string
  formula: string | null
  mass: number | null
  salts: string[]
  archived: boolean
  /** Tanimoto of the two fingerprints, 0 to 1. */
  similarity: number
}

interface HitWire {
  record_id: string
  identifier: string
  title: string
  kind: string
  parent_code: string
  formula: string | null
  mass: number | string | null
  salts: string[] | null
  archived: boolean
  similarity: number | string
}

function toHit(row: HitWire): StructureHit {
  return {
    recordId: row.record_id,
    identifier: row.identifier,
    title: row.title,
    kind: row.kind,
    parentCode: row.parent_code,
    formula: row.formula,
    mass: row.mass === null ? null : Number(row.mass),
    salts: row.salts ?? [],
    archived: row.archived,
    similarity: Number(row.similarity),
  }
}

/** True when the query (drawn as a fragment) sits inside the stored structure. */
export function containsSubstructure(
  ocl: Ocl,
  query: Molecule,
  parentCode: string,
): boolean {
  try {
    const target = ocl.Molecule.fromIDCode(parentCode)
    const searcher = new ocl.SSSearcher()
    searcher.setFragment(query)
    searcher.setMolecule(target)
    return searcher.isFragmentInMolecule()
  } catch {
    return false
  }
}

/** The drawn query as a fragment, ready to search with. */
export function queryFragment(ocl: Ocl, source: string): Molecule | null {
  const molecule = readStructure(ocl, source)
  if (!molecule) return null
  const fragment = molecule.getCompactCopy()
  fragment.setFragment(true)
  fragment.ensureHelperArrays(ocl.Molecule.cHelperParities)
  return fragment
}

export interface StructureSearchInput {
  /** The drawn query: a molfile or a SMILES line. */
  query: string
  mode: SearchMode
  /** Search one registry model, or leave out to search all of them. */
  kind?: string | null
  /** Similarity only: the least Tanimoto score to list, 0 to 1. */
  minSimilarity?: number
  includeArchived?: boolean
  limit?: number
}

/**
 * Structure search. The database narrows by fingerprint; for a substructure
 * search each remaining candidate is then checked atom by atom here, so what is
 * listed really contains the query.
 */
export async function searchStructures(
  client: DataClient,
  input: StructureSearchInput,
  ocl?: Ocl,
): Promise<StructureHit[]> {
  const lib = ocl ?? (await loadOcl())
  // A substructure query is a fragment; a similarity query is a whole molecule
  // with its salts set aside, indexed the way stored parents are.
  let fingerprint: string
  let fragment: Molecule | null = null
  if (input.mode === 'substructure') {
    fragment = queryFragment(lib, input.query)
    if (!fragment) return []
    fingerprint = fingerprintOf(lib, fragment)
  } else {
    const described = describeStructure(lib, input.query)
    if (!described) return []
    fingerprint = described.fingerprint
  }
  const rows = await client.rpc<HitWire[]>('query_structures', {
    p_fingerprint: fingerprint,
    p_mode: input.mode,
    p_kind: input.kind ?? null,
    p_min_similarity: input.minSimilarity ?? 0.5,
    p_include_archived: input.includeArchived ?? false,
    p_limit: input.mode === 'substructure' ? 5000 : (input.limit ?? 200),
  })
  const hits = rows.map(toHit)
  if (input.mode === 'similarity') return hits.slice(0, input.limit ?? 200)
  const limit = input.limit ?? 200
  const confirmed: StructureHit[] = []
  for (const hit of hits) {
    if (fragment && containsSubstructure(lib, fragment, hit.parentCode)) {
      confirmed.push({ ...hit, similarity: 1 })
      if (confirmed.length >= limit) break
    }
  }
  return confirmed
}

// Duplicates and registration ------------------------------------------------

export interface StructureMatch {
  id: string
  identifier: string
  title: string
  archived: boolean
  /** Drawn exactly the same way; otherwise a different salt or solvate. */
  sameForm: boolean
}

interface MatchWire {
  id: string
  identifier: string
  title: string
  archived: boolean
  same_form: boolean
}

export async function findStructureDuplicates(
  client: DataClient,
  input: {
    kind: string
    descriptor: StructureDescriptor
    excludeId?: string | null
  },
): Promise<StructureMatch[]> {
  const rows = await client.rpc<MatchWire[]>('find_structure_duplicates', {
    p_kind: input.kind,
    p_parent_code: input.descriptor.parentCode,
    p_drawn_code: input.descriptor.drawnCode,
    p_exclude_id: input.excludeId ?? null,
  })
  return rows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    title: r.title,
    archived: r.archived,
    sameForm: r.same_form,
  }))
}

export function wireStructure(descriptor: StructureDescriptor) {
  return {
    molfile: descriptor.molfile,
    parentCode: descriptor.parentCode,
    drawnCode: descriptor.drawnCode,
    formula: descriptor.formula,
    mass: descriptor.mass,
    salts: descriptor.salts,
    fingerprint: descriptor.fingerprint,
  }
}

export async function registerCompound<T>(
  client: DataClient,
  input: {
    projectId: string
    kind: string
    title: string
    customFields: Record<string, unknown>
    descriptor: StructureDescriptor
    allowDuplicate: boolean
  },
): Promise<T> {
  return client.rpc<T>('register_compound', {
    p_project_id: input.projectId,
    p_kind: input.kind,
    p_title: input.title,
    p_custom_fields: input.customFields,
    p_structure: wireStructure(input.descriptor),
    p_allow_duplicate: input.allowDuplicate,
  })
}

export async function setRecordStructure<T>(
  client: DataClient,
  input: {
    recordId: string
    metadataVersion: number
    descriptor: StructureDescriptor
    allowDuplicate: boolean
  },
): Promise<T> {
  return client.rpc<T>('set_record_structure', {
    p_record_id: input.recordId,
    p_expected_metadata_version: input.metadataVersion,
    p_structure: wireStructure(input.descriptor),
    p_allow_duplicate: input.allowDuplicate,
  })
}

export async function setModelChemistry(
  client: DataClient,
  input: {
    modelKey: string
    structureField: string | null
    lotKind: string | null
  },
): Promise<void> {
  await client.rpc('set_model_chemistry', {
    p_model_key: input.modelKey,
    p_structure_field: input.structureField,
    p_lot_kind: input.lotKind,
  })
}

// Lots ----------------------------------------------------------------------

export interface CompoundLot {
  id: string
  identifier: string
  title: string
  kind: string
  customFields: Record<string, unknown>
  createdAt: string
  archived: boolean
}

interface LotWire {
  id: string
  identifier: string
  title: string
  kind: string
  custom_fields: Record<string, unknown> | null
  created_at: string
  archived: boolean
}

export async function listCompoundLots(
  client: DataClient,
  compoundId: string,
): Promise<CompoundLot[]> {
  const rows = await client.rpc<LotWire[]>('list_compound_lots', {
    p_compound_id: compoundId,
  })
  return rows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    title: r.title,
    kind: r.kind,
    customFields: r.custom_fields ?? {},
    createdAt: r.created_at,
    archived: r.archived,
  }))
}

export async function addCompoundLot<T>(
  client: DataClient,
  input: {
    compoundId: string
    projectId?: string | null
    title: string
    customFields: Record<string, unknown>
  },
): Promise<T> {
  return client.rpc<T>('add_compound_lot', {
    p_compound_id: input.compoundId,
    p_project_id: input.projectId ?? null,
    p_title: input.title,
    p_custom_fields: input.customFields,
  })
}

// SAR -----------------------------------------------------------------------

export interface StructureRow {
  record_id: string
  parent_code: string
  drawn_code: string
  formula: string | null
  mass: number | string | null
  salts: string[] | null
}

/** The structure rows of one registry model, for the SAR table. */
export async function fetchStructureRows(
  client: DataClient,
  kind: string,
): Promise<StructureRow[]> {
  return client.list<StructureRow>(
    'record_structures',
    `?kind=eq.${encodeURIComponent(kind)}&select=record_id,parent_code,drawn_code,formula,mass,salts&limit=20000`,
  )
}

/** Tanimoto score of two fingerprints, the same measure the database uses. */
export function similarityOf(ocl: Ocl, hexA: string, hexB: string): number {
  return ocl.SSSearcherWithIndex.getSimilarityTanimoto(
    ocl.SSSearcherWithIndex.getIndexFromHexString(hexA.toUpperCase()),
    ocl.SSSearcherWithIndex.getIndexFromHexString(hexB.toUpperCase()),
  )
}

export interface DrugLikeness {
  logP: number
  hbd: number
  hba: number
  tpsa: number
  rotatable: number
  stereo: number
}

/** The properties a SAR table shows beside the structure. */
export function propertiesOf(
  ocl: Ocl,
  parentCode: string,
): DrugLikeness | null {
  try {
    const molecule = ocl.Molecule.fromIDCode(parentCode)
    const p = new ocl.MoleculeProperties(molecule)
    return {
      logP: Number(p.logP.toFixed(2)),
      hbd: p.donorCount,
      hba: p.acceptorCount,
      tpsa: Number(p.polarSurfaceArea.toFixed(1)),
      rotatable: p.rotatableBondCount,
      stereo: p.stereoCenterCount,
    }
  } catch {
    return null
  }
}

/** Picture of a parent structure from its code. */
export function parentSvg(
  ocl: Ocl,
  parentCode: string,
  height = 90,
): string | null {
  try {
    const molecule = ocl.Molecule.fromIDCode(parentCode)
    return molecule
      .toSVG(height * 2, height, undefined, {
        autoCrop: true,
        autoCropMargin: 3,
        suppressChiralText: true,
      })
      .replace(/rgb\(0,\s*0,\s*0\)/g, 'currentColor')
  } catch {
    return null
  }
}

// Existing entries ------------------------------------------------------------

/**
 * Reads the structures of entries added before the model took structures, so
 * they are checked and searchable. Returns how many were read.
 */
export async function indexExistingStructures(
  client: DataClient,
  ocl: Ocl,
  model: { key: string; registry_structure_field: string },
): Promise<number> {
  const field = model.registry_structure_field
  const [records, known] = await Promise.all([
    client.list<{ id: string; custom_fields: Record<string, unknown> | null }>(
      'records',
      `?kind=eq.${encodeURIComponent(model.key)}&deleted_at=is.null&select=id,custom_fields&limit=20000`,
    ),
    fetchStructureRows(client, model.key),
  ])
  const done = new Set(known.map((row) => row.record_id))
  let read = 0
  for (const record of records) {
    if (done.has(record.id)) continue
    const molfile = record.custom_fields?.[field]
    if (typeof molfile !== 'string' || !molfile.trim()) continue
    const described = describeStructure(ocl, molfile)
    if (!described) continue
    await client.rpc('index_record_structure', {
      p_record_id: record.id,
      p_structure: wireStructure(described),
    })
    read++
  }
  return read
}

// Ready-made compound registry -----------------------------------------------

/** A compound registry and the model its lots are made from. */
export const COMPOUND_STARTER = {
  lot: {
    key: 'compound_lot',
    name: 'Compound lot',
    prefix: 'LOT',
    description: t('registry.chemistry.starters.lotDescription'),
    fields: [
      { field_name: 'lot_number', label: 'Lot number', show_in_list: true },
      { field_name: 'supplier', label: 'Supplier' },
      { field_name: 'amount', label: 'Amount' },
      {
        field_name: 'purity_percent',
        label: 'Purity (%)',
        logical_type: 'decimal',
      },
      { field_name: 'received_on', label: 'Received', logical_type: 'date' },
      { field_name: 'notes', label: 'Notes' },
    ],
  },
  compound: {
    key: 'compound',
    name: 'Compound',
    prefix: 'CMP',
    description: t('registry.chemistry.starters.compoundDescription'),
    fields: [
      { field_name: 'structure', label: 'Structure' },
      { field_name: 'cas_number', label: 'CAS number' },
      { field_name: 'target', label: 'Target', show_in_list: true },
      {
        field_name: 'ic50_nm',
        label: 'IC50 (nM)',
        logical_type: 'decimal',
        show_in_list: true,
      },
      {
        field_name: 'solubility_um',
        label: 'Solubility (µM)',
        logical_type: 'decimal',
      },
    ],
  },
} as const

export async function createCompoundStarter(client: DataClient): Promise<void> {
  const { lot, compound } = COMPOUND_STARTER
  await client.rpc('create_starter_model', {
    p_key: lot.key,
    p_name: lot.name,
    p_prefix: lot.prefix,
    p_description: lot.description,
    p_fields: lot.fields,
    p_incident_log: false,
  })
  await client.rpc('create_registry_model', {
    p_key: compound.key,
    p_name: compound.name,
    p_prefix: compound.prefix,
    p_description: compound.description,
    p_fields: compound.fields,
    p_key_fields: [],
    p_sequence_field: null,
  })
  await setModelChemistry(client, {
    modelKey: compound.key,
    structureField: 'structure',
    lotKind: lot.key,
  })
}
