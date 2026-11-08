/**
 * Registering a cloning product: it becomes an entry in a registry (a record
 * model with the Registry box ticked), named by the lab's own numbering, with
 * lineage to the parts it was built from.
 */
import { reverseComplement } from '#/lib/molbio'
import type { AssemblyProduct } from '#/lib/molbio'
import type { ParsedSequence } from '#/lib/sequence'
import type { AssemblyPlan, PlanPart } from '#/lib/sequence-block'

export type ParentRole =
  | 'parent'
  | 'vector'
  | 'insert'
  | 'backbone'
  | 'transfected_with'
  | 'clone_of'

export interface RegistryModel {
  id: string
  key: string
  name: string
  identifier_prefix: string
  registry_key_fields: string[]
  registry_sequence_field: string | null
}

export interface DuplicateMatch {
  id: string
  identifier: string
  title: string
  archived: boolean
  match: 'exact' | 'name'
}

export interface Registered {
  recordId: string
  identifier: string
  title: string
}

export const registryModels = () =>
  sheetbase.host<RegistryModel[]>('registry.models')

function leastRotation(s: string): string {
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
 * the same from either strand, and for a circle the same from any start.
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

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function sequenceFingerprint(seq: ParsedSequence): Promise<string> {
  return `seq:${await sha256(
    canonicalSequence(seq.residues, seq.molecule, seq.topology),
  )}`
}

/** The part a product part came from, with the role it played. */
export function parentsOf(
  plan: AssemblyPlan,
  product: AssemblyProduct,
): { recordId: string; role: ParentRole }[] {
  const byId = new Map<string, PlanPart>(plan.parts.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const out: { recordId: string; role: ParentRole }[] = []
  for (const placed of product.parts) {
    const part = byId.get(placed.partId)
    if (!part?.registryRecordId || seen.has(part.registryRecordId)) continue
    seen.add(part.registryRecordId)
    out.push({
      recordId: part.registryRecordId,
      role: part.topology === 'circular' ? 'vector' : 'insert',
    })
  }
  return out
}

function fields(
  model: RegistryModel,
  fingerprint: string,
  seq: ParsedSequence,
  extras: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (model.registry_sequence_field)
    out[model.registry_sequence_field] = fingerprint
  if (extras) {
    out.sequence_length = String(seq.length)
    out.shape = seq.topology
  }
  return out
}

/** What is already in the registry with this sequence. */
export async function duplicatesOf(
  model: RegistryModel,
  sequence: ParsedSequence,
  title: string,
): Promise<DuplicateMatch[]> {
  return sheetbase.host<DuplicateMatch[]>('registry.findDuplicates', {
    model: model.key,
    title,
    customFields: fields(model, await sequenceFingerprint(sequence), sequence, false),
  })
}

export async function registerProduct(input: {
  model: RegistryModel
  title: string
  sequence: ParsedSequence
  parents: { recordId: string; role: ParentRole }[]
  allowDuplicate: boolean
}): Promise<Registered> {
  const fingerprint = await sequenceFingerprint(input.sequence)
  const withExtras = input.model.key === 'construct'
  return sheetbase.host<Registered>('registry.create', {
    model: input.model.key,
    title: input.title,
    customFields: fields(input.model, fingerprint, input.sequence, withExtras),
    ...(withExtras
      ? {}
      : { fallbackCustomFields: fields(input.model, fingerprint, input.sequence, false) }),
    allowDuplicate: input.allowDuplicate,
    parents: input.parents,
  })
}

export const isDuplicateError = (error: unknown) =>
  error instanceof Error && (error as { code?: string }).code === 'duplicate'
