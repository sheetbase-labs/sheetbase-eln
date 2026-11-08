/**
 * The sequence block: a DNA, RNA or protein sequence in a notebook, with the
 * work done on it. Besides the sequence and its features, the block keeps what
 * a scientist would otherwise paste into the page by hand: the primers they
 * designed, the cloning plans they ran, the Sanger reads they checked against
 * it, and the registry entries they made from it.
 *
 * Everything here is plain data so the server can validate it and build the
 * text people search, and tests can run without a browser. The sequence maths
 * lives in `#/lib/molbio`.
 */
import { encodeQuality } from '#/lib/molbio'
import type { SequenceFeature } from '#/lib/sequence'

export const SEQUENCE_METHODS = ['ligation', 'golden_gate', 'gibson'] as const
export type SequenceMethod = (typeof SEQUENCE_METHODS)[number]

export interface SavedPrimer {
  id: string
  name: string
  /** 5' to 3'. */
  seq: string
  /** Where it binds on this sequence (1-based, inclusive), when it does. */
  start?: number
  end?: number
  strand?: 1 | -1
  note?: string
}

export interface PlanPart {
  id: string
  name: string
  seq: string
  topology: 'linear' | 'circular'
  features: SequenceFeature[]
  /** The sequence block it was taken from, when it came from one. */
  blockId?: string
  /** The registry entry this part is, so the product can name its parents. */
  registryRecordId?: string
  registryIdentifier?: string
}

export interface AssemblyPlan {
  id: string
  name: string
  method: SequenceMethod
  /** Enzymes for digest-and-ligate (per part, by part id) or the one Type IIS
   * enzyme of a Golden Gate. */
  enzymes: string[]
  partEnzymes?: Record<string, string[]>
  /** How each part is cut in a digest-and-ligate: 'largest', 'smallest' or the
   * fragment numbers (largest first). */
  partPick?: Record<string, 'largest' | 'smallest' | number[]>
  parts: PlanPart[]
  /** Overlap range for Gibson. */
  minOverlap?: number
}

export interface StoredRead {
  id: string
  name: string
  bases: string
  /** Phred+33. */
  quality: string
  /** The trace, packed (see `packTrace`), kept for the chromatogram. */
  trace?: string
}

export interface RegisteredProduct {
  recordId: string
  identifier: string
  title: string
  method: SequenceMethod
  planId?: string
  registeredAt: string
}

export interface DigestSetup {
  enzymes: string[]
  ladder: '1kb' | '100bp'
}

export interface SequenceBlockPayload {
  title?: string
  caption?: string
  name: string
  molecule: 'dna' | 'rna' | 'protein'
  topology: 'linear' | 'circular'
  residues: string
  features: SequenceFeature[]
  /** The registry entry this sequence is, once it has been registered. */
  registryRecordId?: string
  registryIdentifier?: string
  /** The GenBank or FASTA file it was read from. */
  sourceFileRecordId?: string
  /** Enzymes drawn on the map. */
  mapEnzymes?: string[]
  digests?: DigestSetup[]
  primers?: SavedPrimer[]
  plans?: AssemblyPlan[]
  reads?: StoredRead[]
  products?: RegisteredProduct[]
}

export const EMPTY_SEQUENCE_PAYLOAD: SequenceBlockPayload = {
  name: '',
  molecule: 'dna',
  topology: 'circular',
  residues: '',
  features: [],
}

export const MAX_SEQUENCE_LENGTH = 400_000
export const MAX_READS = 24
export const MAX_PRIMERS = 200
export const MAX_PLANS = 20
export const MAX_PLAN_PARTS = 12

export interface SequenceIssue {
  field: string
  message: string
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

function featureIssues(features: unknown, length: number): SequenceIssue[] {
  if (!Array.isArray(features))
    return [{ field: 'features', message: 'features must be a list' }]
  const issues: SequenceIssue[] = []
  features.forEach((f: unknown, i) => {
    const at = `features[${i}]`
    if (!isObject(f))
      return void issues.push({ field: at, message: 'must be an object' })
    if (!isString(f.label) || !isString(f.type))
      issues.push({ field: at, message: 'needs a label and a type' })
    if (f.strand !== 1 && f.strand !== -1)
      issues.push({ field: `${at}.strand`, message: 'strand must be 1 or -1' })
    if (
      !Array.isArray(f.parts) ||
      f.parts.length === 0 ||
      f.parts.some(
        (p: unknown) =>
          !isObject(p) ||
          !Number.isInteger(p.start) ||
          !Number.isInteger(p.end) ||
          (p.start as number) < 1 ||
          (p.end as number) > length,
      )
    )
      issues.push({
        field: `${at}.parts`,
        message: 'each part needs a start and end inside the sequence',
      })
  })
  return issues
}

export function sequenceIssues(payload: unknown): SequenceIssue[] {
  if (!isObject(payload))
    return [{ field: '', message: 'payload must be an object' }]
  const issues: SequenceIssue[] = []
  if (
    !isString(payload.residues) ||
    payload.residues.length > MAX_SEQUENCE_LENGTH
  )
    issues.push({
      field: 'residues',
      message: `residues must be text of at most ${MAX_SEQUENCE_LENGTH} letters`,
    })
  else if (!/^[A-Za-z*]*$/.test(payload.residues))
    issues.push({ field: 'residues', message: 'residues must be letters only' })
  if (!isString(payload.name))
    issues.push({ field: 'name', message: 'name must be a string' })
  if (!['dna', 'rna', 'protein'].includes(String(payload.molecule)))
    issues.push({
      field: 'molecule',
      message: 'molecule must be dna, rna or protein',
    })
  if (!['linear', 'circular'].includes(String(payload.topology)))
    issues.push({
      field: 'topology',
      message: 'topology must be linear or circular',
    })
  for (const f of [
    'title',
    'caption',
    'registryRecordId',
    'registryIdentifier',
    'sourceFileRecordId',
  ]) {
    if (payload[f] !== undefined && !isString(payload[f]))
      issues.push({ field: f, message: `${f} must be a string when present` })
  }
  if (isString(payload.residues))
    issues.push(
      ...featureIssues(payload.features ?? [], payload.residues.length),
    )
  const lists: [string, number][] = [
    ['primers', MAX_PRIMERS],
    ['plans', MAX_PLANS],
    ['reads', MAX_READS],
    ['products', 200],
    ['digests', 40],
  ]
  for (const [field, max] of lists) {
    const v = payload[field]
    if (v === undefined) continue
    if (!Array.isArray(v) || v.length > max)
      issues.push({
        field,
        message: `${field} must be a list of at most ${max}`,
      })
  }
  if (Array.isArray(payload.primers))
    payload.primers.forEach((p: unknown, i) => {
      if (
        !isObject(p) ||
        !isString(p.seq) ||
        !/^[ACGTRYKMSWBDHVN]+$/i.test(p.seq)
      )
        issues.push({
          field: `primers[${i}].seq`,
          message: 'a primer needs a DNA sequence',
        })
    })
  if (Array.isArray(payload.plans))
    payload.plans.forEach((p: unknown, i) => {
      if (
        !isObject(p) ||
        !SEQUENCE_METHODS.includes(p.method as SequenceMethod) ||
        !Array.isArray(p.parts) ||
        p.parts.length > MAX_PLAN_PARTS
      )
        issues.push({
          field: `plans[${i}]`,
          message: 'a plan needs a method and its parts',
        })
    })
  return issues
}

/** A payload as the editors read it, with every list present. */
export function sequenceOf(payload: unknown): SequenceBlockPayload {
  const p = (payload ?? {}) as Partial<SequenceBlockPayload>
  return {
    ...p,
    name: isString(p.name) ? p.name : '',
    molecule: p.molecule ?? 'dna',
    topology: p.topology ?? 'circular',
    residues: isString(p.residues) ? p.residues : '',
    features: Array.isArray(p.features) ? p.features : [],
  }
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${rand}${counter}`
}

/** A read in the form the block stores it. */
export function storedRead(
  name: string,
  bases: string,
  quality: readonly number[],
  trace?: string,
): StoredRead {
  return {
    id: newId('read'),
    name,
    bases,
    quality: encodeQuality(quality),
    ...(trace ? { trace } : {}),
  }
}

/** Words for search and for the conflict summary. */
export function sequenceSearchText(p: SequenceBlockPayload): string {
  return [
    p.title,
    p.caption,
    p.name,
    p.registryIdentifier,
    ...p.features.map((f) => `${f.label} ${f.type}`),
    ...(p.primers ?? []).map((x) => `${x.name} ${x.seq}`),
    ...(p.plans ?? []).map(
      (x) => `${x.name} ${x.parts.map((q) => q.name).join(' ')}`,
    ),
    ...(p.reads ?? []).map((x) => x.name),
    ...(p.products ?? []).map((x) => `${x.identifier} ${x.title}`),
  ]
    .filter(Boolean)
    .join(' ')
}
