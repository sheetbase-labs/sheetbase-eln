/**
 * Biological registry: constructs, cell lines and antibodies with numbers that
 * never change, a duplicate check before anything is added, and the lineage of
 * what came from what (migration 0070).
 *
 * Reads go straight to `api.registry_entries`, `registry_parents` and
 * `registry_uses` under row-level security; every change goes through an RPC.
 */
import type { DataClient } from '#/lib/data-client'
import { reverseComplement } from '#/lib/sequence'
import type { ParsedSequence } from '#/lib/sequence'

export const REGISTRY_KINDS = ['construct', 'cell_line', 'antibody'] as const
export type RegistryKind = (typeof REGISTRY_KINDS)[number]

export type RegistryStatus = 'active' | 'retired'

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

export const registryKeys = {
  all: ['registry'] as const,
  list: ['registry', 'list'] as const,
  entry: (id: string) => ['registry', 'entry', id] as const,
}

/** The fields each kind asks for. The values live in the entry's details. */
export interface DetailField {
  key: string
  type: 'text' | 'choice'
  choices?: readonly string[]
}

export const DETAIL_FIELDS: Record<RegistryKind, readonly DetailField[]> = {
  construct: [
    { key: 'purpose', type: 'text' },
    { key: 'selection', type: 'text' },
    { key: 'host', type: 'text' },
    { key: 'source', type: 'text' },
  ],
  cell_line: [
    { key: 'species', type: 'text' },
    { key: 'tissue', type: 'text' },
    { key: 'cellType', type: 'text' },
    { key: 'medium', type: 'text' },
    { key: 'externalId', type: 'text' },
    {
      key: 'mycoplasma',
      type: 'choice',
      choices: ['untested', 'negative', 'positive'],
    },
  ],
  antibody: [
    { key: 'target', type: 'text' },
    { key: 'hostSpecies', type: 'text' },
    { key: 'clonality', type: 'choice', choices: ['monoclonal', 'polyclonal'] },
    { key: 'clone', type: 'text' },
    { key: 'isotype', type: 'text' },
    { key: 'conjugate', type: 'text' },
    { key: 'vendor', type: 'text' },
    { key: 'catalogueNumber', type: 'text' },
    { key: 'applications', type: 'text' },
  ],
}

export interface RegistryEntryWire {
  id: string
  kind: string
  number: number
  registry_id: string
  name: string
  description: string | null
  status: string
  details: Record<string, unknown>
  fingerprint: string | null
  retired_reason: string | null
  retired_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RegistryEntry {
  id: string
  kind: RegistryKind
  registryId: string
  name: string
  description: string | null
  status: RegistryStatus
  details: Record<string, string>
  fingerprint: string | null
  retiredReason: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export function isRegistryKind(value: string): value is RegistryKind {
  return (REGISTRY_KINDS as readonly string[]).includes(value)
}

export function toEntry(row: RegistryEntryWire): RegistryEntry {
  const details: Record<string, string> = {}
  for (const [key, value] of Object.entries(row.details)) {
    if (typeof value === 'string' || typeof value === 'number') {
      details[key] = String(value)
    }
  }
  return {
    id: row.id,
    kind: isRegistryKind(row.kind) ? row.kind : 'construct',
    registryId: row.registry_id,
    name: row.name,
    description: row.description,
    status: row.status === 'retired' ? 'retired' : 'active',
    details,
    fingerprint: row.fingerprint,
    retiredReason: row.retired_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface RegistryParentWire {
  entry_id: string
  parent_id: string
  role: string
}

export interface RegistryUseWire {
  entry_id: string
  record_id: string
  created_at: string
}

export async function fetchEntries(
  client: DataClient,
): Promise<RegistryEntry[]> {
  const rows = await client.list<RegistryEntryWire>(
    'registry_entries',
    '?select=*&order=kind.asc,number.desc&limit=5000',
  )
  return rows.map(toEntry)
}

export async function fetchParents(
  client: DataClient,
): Promise<RegistryParentWire[]> {
  return client.list<RegistryParentWire>(
    'registry_parents',
    '?select=entry_id,parent_id,role&limit=20000',
  )
}

export async function fetchUses(
  client: DataClient,
  entryId: string,
): Promise<RegistryUseWire[]> {
  return client.list<RegistryUseWire>(
    'registry_uses',
    `?entry_id=eq.${entryId}&select=entry_id,record_id,created_at&order=created_at.desc`,
  )
}

export interface DuplicateMatch {
  id: string
  registryId: string
  name: string
  status: RegistryStatus
  /** "exact": same sequence or catalogue number. "name": same name. */
  match: 'exact' | 'name'
}

interface DuplicateWire {
  id: string
  registry_id: string
  name: string
  status: string
  match: string
}

export async function findDuplicates(
  client: DataClient,
  input: {
    kind: RegistryKind
    name: string
    fingerprint: string | null
    excludeId?: string | null
  },
): Promise<DuplicateMatch[]> {
  const rows = await client.rpc<DuplicateWire[]>('registry_find_duplicates', {
    p_kind: input.kind,
    p_name: input.name,
    p_fingerprint: input.fingerprint,
    p_exclude_id: input.excludeId ?? null,
  })
  return rows.map((row) => ({
    id: row.id,
    registryId: row.registry_id,
    name: row.name,
    status: row.status === 'retired' ? 'retired' : 'active',
    match: row.match === 'exact' ? 'exact' : 'name',
  }))
}

export interface EntryInput {
  kind: RegistryKind
  name: string
  description: string | null
  details: Record<string, string>
  fingerprint: string | null
  parents: { id: string; role: ParentRole }[]
}

/** Drop empty values so an entry only stores what someone filled in. */
export function cleanDetails(
  details: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value !== ''),
  )
}

export async function createEntry(
  client: DataClient,
  input: EntryInput,
  allowDuplicate: boolean,
): Promise<RegistryEntry> {
  const row = await client.rpc<RegistryEntryWire>('create_registry_entry', {
    p_kind: input.kind,
    p_name: input.name,
    p_description: input.description,
    p_details: cleanDetails(input.details),
    p_fingerprint: input.fingerprint,
    p_parents: input.parents,
    p_allow_duplicate: allowDuplicate,
  })
  return toEntry(row)
}

export async function updateEntry(
  client: DataClient,
  id: string,
  input: Omit<EntryInput, 'kind' | 'parents'>,
): Promise<RegistryEntry> {
  const row = await client.rpc<RegistryEntryWire>('update_registry_entry', {
    p_id: id,
    p_name: input.name,
    p_description: input.description,
    p_details: cleanDetails(input.details),
    p_fingerprint: input.fingerprint,
  })
  return toEntry(row)
}

export async function setEntryStatus(
  client: DataClient,
  id: string,
  status: RegistryStatus,
  reason: string | null,
): Promise<void> {
  await client.rpc('set_registry_entry_status', {
    p_id: id,
    p_status: status,
    p_reason: reason,
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

export async function setUse(
  client: DataClient,
  entryId: string,
  recordId: string,
  linked: boolean,
): Promise<void> {
  await client.rpc('set_registry_use', {
    p_entry_id: entryId,
    p_record_id: recordId,
    p_linked: linked,
  })
}

// Lineage ------------------------------------------------------------------

export interface LineageNode {
  entry: RegistryEntry
  role: ParentRole | null
  depth: number
}

function asRole(value: string): ParentRole {
  return (PARENT_ROLES as readonly string[]).includes(value)
    ? (value as ParentRole)
    : 'parent'
}

/**
 * Everything an entry came from (`up`) or went on to make (`down`), nearest
 * first, each entry once. The role is the part that entry played in the link
 * to the one before it.
 */
export function walkLineage(
  start: string,
  direction: 'up' | 'down',
  entries: readonly RegistryEntry[],
  links: readonly RegistryParentWire[],
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
        out.push({ entry, role: asRole(link.role), depth })
      }
    }
    frontier = next
  }
  return out
}

// Duplicate fingerprints ---------------------------------------------------

function normalise(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** The least rotation of a string (Booth's algorithm), in linear time. */
export function leastRotation(s: string): string {
  const n = s.length
  if (n < 2) return s
  const doubled = s + s
  const failure = new Array<number>(2 * n).fill(-1)
  let k = 0
  for (let j = 1; j < 2 * n; j++) {
    const c = doubled[j]
    let i = failure[j - k - 1]
    while (i !== -1 && c !== doubled[k + i + 1]) {
      if (c < doubled[k + i + 1]) k = j - i - 1
      i = failure[i]
    }
    if (c !== doubled[k + i + 1]) {
      if (c < doubled[k]) k = j
      failure[j - k] = -1
    } else {
      failure[j - k] = i + 1
    }
  }
  return s.slice(k) + s.slice(0, k)
}

/**
 * One form for a sequence however it was written down: upper case, bases only,
 * the same from either strand, and for a circle the same from any start. Two
 * files of the same plasmid cut at different places give the same text.
 */
export function canonicalSequence(
  residues: string,
  molecule: ParsedSequence['molecule'],
  topology: ParsedSequence['topology'],
): string {
  const seq = residues.toUpperCase().replace(/[^A-Z*]/g, '')
  if (molecule === 'protein') return seq
  const dna = molecule === 'rna' ? seq.replace(/U/g, 'T') : seq
  const forward = topology === 'circular' ? leastRotation(dna) : dna
  const rc = reverseComplement(dna)
  const reverse = topology === 'circular' ? leastRotation(rc) : rc
  return forward <= reverse ? forward : reverse
}

export async function sequenceFingerprint(
  seq: ParsedSequence,
): Promise<string> {
  return `seq:${await sha256(
    canonicalSequence(seq.residues, seq.molecule, seq.topology),
  )}`
}

/** What the duplicate check compares for kinds that have no sequence. */
export function entryFingerprint(
  kind: RegistryKind,
  details: Record<string, string>,
): string | null {
  if (kind === 'antibody') {
    const vendor = normalise(details.vendor)
    const catalogue = normalise(details.catalogueNumber)
    if (vendor && catalogue) return `cat:${vendor}:${catalogue}`
    return null
  }
  if (kind === 'cell_line') {
    const external = normalise(details.externalId)
    return external ? `ext:${external}` : null
  }
  return null
}

/** The line shown beside a construct's sequence. */
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
