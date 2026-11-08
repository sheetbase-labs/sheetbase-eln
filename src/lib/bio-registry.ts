/**
 * Biological registries (migration 0070). A registry is a record model with
 * the Registry box ticked: its records get numbers that never change, a
 * duplicate check before anything is added, and lineage between entries.
 * Constructs, cell lines and antibodies are ready-made registries; any other
 * model can be ticked the same way.
 *
 * Entries are ordinary records (`api.records`), so they read under row-level
 * security like any record; changes go through RPCs.
 */
import type { DataClient } from '#/lib/data-client'
import { samenessKeyFor } from '#/lib/registry-sameness'
import { canonicalSequence } from '#/lib/sequence-fingerprint'
import type { ParsedSequence } from '#/lib/sequence'

export const registryKeys = {
  all: ['registry'] as const,
  models: ['registry', 'models'] as const,
  entries: (keys: readonly string[]) =>
    ['registry', 'entries', ...keys] as const,
  lineage: ['registry', 'lineage'] as const,
}

/** What an entry came from, and the part it played. */
export const PARENT_ROLES = [
  'parent',
  'vector',
  'insert',
  'backbone',
  'transfected_with',
  'clone_of',
] as const
export type ParentRole = (typeof PARENT_ROLES)[number]

export function asRole(value: unknown): ParentRole {
  return (PARENT_ROLES as readonly string[]).includes(String(value))
    ? (value as ParentRole)
    : 'parent'
}

export interface RegistryModel {
  id: string
  key: string
  name: string
  identifier_prefix: string
  registry_key_fields: string[]
  registry_sequence_field: string | null
  registry_lot_kind: string | null
}

export interface RegistryEntry {
  id: string
  identifier: string
  title: string
  kind: string
  custom_fields: Record<string, unknown> | null
  created_at: string
  archived_at: string | null
  metadata_version: number
}

export interface DuplicateMatch {
  id: string
  identifier: string
  title: string
  archived: boolean
  /** "exact": every key field matches. "name": the same name. */
  match: 'exact' | 'name'
}

export async function fetchRegistryModels(
  client: DataClient,
): Promise<RegistryModel[]> {
  return client.list<RegistryModel>(
    'record_models',
    '?is_registry=eq.true&select=id,key,name,identifier_prefix,registry_key_fields,registry_sequence_field,registry_lot_kind&order=name.asc',
  )
}

export async function fetchRegistryEntries(
  client: DataClient,
  kinds: readonly string[],
): Promise<RegistryEntry[]> {
  if (kinds.length === 0) return []
  const list = kinds.map((k) => encodeURIComponent(k)).join(',')
  return client.list<RegistryEntry>(
    'records',
    `?kind=in.(${list})&deleted_at=is.null&order=created_at.desc&limit=5000&select=id,identifier,title,kind,custom_fields,created_at,archived_at,metadata_version`,
  )
}

export interface LineageLink {
  entry_id: string
  parent_id: string
  role: ParentRole
}

interface LineageWire {
  source_record_id: string
  target_record_id: string | null
  link_metadata: { role?: string } | null
}

/** Every "came from" link between entries of the given registries. */
export async function fetchLineageLinks(
  client: DataClient,
  entryIds: readonly string[],
): Promise<LineageLink[]> {
  if (entryIds.length === 0) return []
  const rows = await client.list<LineageWire>(
    'record_links',
    `?link_type=eq.upstream&source_record_id=in.(${entryIds.join(',')})&select=source_record_id,target_record_id,link_metadata&limit=20000`,
  )
  return rows
    .filter((r) => r.target_record_id)
    .map((r) => ({
      entry_id: r.source_record_id,
      parent_id: r.target_record_id ?? '',
      role: asRole(r.link_metadata?.role),
    }))
}

interface DuplicateWire {
  id: string
  identifier: string
  title: string
  archived: boolean
  match: string
}

export async function findDuplicates(
  client: DataClient,
  input: {
    kind: string
    title: string
    customFields: Record<string, unknown>
    excludeId?: string | null
  },
): Promise<DuplicateMatch[]> {
  const rows = await client.rpc<DuplicateWire[]>('registry_find_duplicates', {
    p_kind: input.kind,
    p_title: input.title,
    p_custom_fields: input.customFields,
    p_exclude_id: input.excludeId ?? null,
  })
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    archived: row.archived,
    match: row.match === 'exact' ? 'exact' : 'name',
  }))
}

export async function createRegistryEntry<T>(
  client: DataClient,
  input: {
    projectId: string
    kind: string
    title: string
    customFields: Record<string, unknown>
    allowDuplicate: boolean
    /** The key the model's plugin rule gave, when the caller has it already. Worked out here when left out. */
    samenessValue?: string | null
  },
): Promise<T> {
  const samenessValue =
    input.samenessValue !== undefined
      ? input.samenessValue
      : await samenessKeyFor(client, {
          modelKey: input.kind,
          title: input.title,
          customFields: input.customFields,
        })
  return client.rpc<T>('create_registry_entry', {
    p_project_id: input.projectId,
    p_kind: input.kind,
    p_title: input.title,
    p_custom_fields: input.customFields,
    p_allow_duplicate: input.allowDuplicate,
    p_sameness_value: samenessValue,
  })
}

export async function setModelRegistry(
  client: DataClient,
  input: {
    modelKey: string
    isRegistry: boolean
    keyFields: string[]
    sequenceField: string | null
  },
): Promise<void> {
  await client.rpc('set_model_registry', {
    p_model_key: input.modelKey,
    p_is_registry: input.isRegistry,
    p_key_fields: input.keyFields,
    p_sequence_field: input.sequenceField,
  })
}

export async function addParent(
  client: DataClient,
  entryId: string,
  parentId: string,
  role: ParentRole,
): Promise<void> {
  await client.rpc('add_registry_parent', {
    p_entry_id: entryId,
    p_parent_id: parentId,
    p_role: role,
  })
}

export async function removeParent(
  client: DataClient,
  entryId: string,
  parentId: string,
): Promise<void> {
  await client.rpc('remove_registry_parent', {
    p_entry_id: entryId,
    p_parent_id: parentId,
  })
}

// Ready-made registries ------------------------------------------------------

export interface StarterField {
  field_name: string
  label: string
  show_in_list?: boolean
}

export interface StarterRegistry {
  key: string
  name: string
  prefix: string
  description: string
  fields: StarterField[]
  keyFields: string[]
  sequenceField: string | null
}

export const STARTER_REGISTRIES: readonly StarterRegistry[] = [
  {
    key: 'construct',
    name: 'Construct',
    prefix: 'CON',
    description: 'Plasmids and other DNA constructs.',
    fields: [
      { field_name: 'purpose', label: 'Purpose', show_in_list: true },
      { field_name: 'selection', label: 'Selection', show_in_list: true },
      { field_name: 'host', label: 'Host' },
      { field_name: 'source', label: 'Source' },
      { field_name: 'sequence_fingerprint', label: 'Sequence fingerprint' },
      { field_name: 'sequence_length', label: 'Length', show_in_list: true },
      { field_name: 'shape', label: 'Shape' },
    ],
    keyFields: ['sequence_fingerprint'],
    sequenceField: 'sequence_fingerprint',
  },
  {
    key: 'cell_line',
    name: 'Cell line',
    prefix: 'CL',
    description: 'Cell lines and the banks they are kept in.',
    fields: [
      { field_name: 'species', label: 'Species', show_in_list: true },
      { field_name: 'tissue', label: 'Tissue' },
      { field_name: 'cell_type', label: 'Cell type', show_in_list: true },
      { field_name: 'medium', label: 'Medium' },
      { field_name: 'cell_bank_number', label: 'Cell bank number' },
      { field_name: 'mycoplasma', label: 'Mycoplasma' },
    ],
    keyFields: ['cell_bank_number'],
    sequenceField: null,
  },
  {
    key: 'antibody',
    name: 'Antibody',
    prefix: 'AB',
    description: 'Antibodies by target, clone and catalogue number.',
    fields: [
      { field_name: 'target', label: 'Target', show_in_list: true },
      { field_name: 'host_species', label: 'Host species' },
      { field_name: 'clonality', label: 'Clonality' },
      { field_name: 'clone', label: 'Clone', show_in_list: true },
      { field_name: 'isotype', label: 'Isotype' },
      { field_name: 'conjugate', label: 'Conjugate' },
      { field_name: 'vendor', label: 'Vendor' },
      { field_name: 'catalogue_number', label: 'Catalogue number' },
      { field_name: 'applications', label: 'Applications' },
    ],
    keyFields: ['vendor', 'catalogue_number'],
    sequenceField: null,
  },
  {
    key: 'reference',
    name: 'Reference',
    prefix: 'REF',
    description: 'Papers the lab relies on, found by DOI.',
    fields: [
      { field_name: 'authors', label: 'Authors', show_in_list: true },
      { field_name: 'journal', label: 'Journal', show_in_list: true },
      { field_name: 'year', label: 'Year', show_in_list: true },
      { field_name: 'doi', label: 'DOI' },
      { field_name: 'link', label: 'Link' },
      { field_name: 'abstract', label: 'Abstract' },
    ],
    keyFields: ['doi'],
    sequenceField: null,
  },
]

export async function createStarterRegistry(
  client: DataClient,
  starter: StarterRegistry,
): Promise<void> {
  await client.rpc('create_registry_model', {
    p_key: starter.key,
    p_name: starter.name,
    p_prefix: starter.prefix,
    p_description: starter.description,
    p_fields: starter.fields,
    p_key_fields: starter.keyFields,
    p_sequence_field: starter.sequenceField,
  })
}

// Duplicate fingerprints ---------------------------------------------------

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export { canonicalSequence, leastRotation } from '#/lib/sequence-fingerprint'

export async function sequenceFingerprint(
  seq: ParsedSequence,
): Promise<string> {
  return `seq:${await sha256(
    canonicalSequence(seq.residues, seq.molecule, seq.topology),
  )}`
}

export interface SequenceInfo {
  molecule: ParsedSequence['molecule']
  topology: ParsedSequence['topology']
  length: number
  fingerprint: string
}

export async function readSequence(seq: ParsedSequence): Promise<SequenceInfo> {
  return {
    molecule: seq.molecule,
    topology: seq.topology,
    length: seq.length,
    fingerprint: await sequenceFingerprint(seq),
  }
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** True when the database refused because the entry is already registered. */
export function isDuplicateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'SB012'
  )
}

/** Entries reached from `start`, nearest first, each once. */
export interface LineageNode {
  entry: RegistryEntry
  role: ParentRole
  depth: number
}

export function walkLineage(
  start: string,
  direction: 'up' | 'down',
  entries: readonly RegistryEntry[],
  links: readonly LineageLink[],
  maxDepth = 12,
): LineageNode[] {
  const byId = new Map(entries.map((e) => [e.id, e] as const))
  const seen = new Set<string>([start])
  const out: LineageNode[] = []
  let frontier = [start]
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const link of links) {
        const from = direction === 'up' ? link.entry_id : link.parent_id
        const to = direction === 'up' ? link.parent_id : link.entry_id
        if (from !== id || seen.has(to)) continue
        const entry = byId.get(to)
        if (!entry) continue
        seen.add(to)
        next.push(to)
        out.push({ entry, role: link.role, depth })
      }
    }
    frontier = next
  }
  return out
}
