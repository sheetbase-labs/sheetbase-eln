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
import { z } from 'zod'

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

// Validate the stored shape without stripping fields added by newer clients.
const strand = z.union([z.literal(1), z.literal(-1)])

const feature = z.looseObject({
  id: z.number(),
  type: z.string(),
  label: z.string(),
  strand,
  parts: z.array(z.looseObject({ start: z.number(), end: z.number() })),
  start: z.number(),
  end: z.number(),
  qualifiers: z.record(z.string(), z.string()),
})

const topology = z.enum(['linear', 'circular'])
const assemblyMethod = z.enum(SEQUENCE_METHODS)

const part = z.looseObject({
  id: z.string(),
  name: z.string(),
  seq: z.string(),
  topology,
  features: z.array(feature),
  blockId: z.string().optional(),
  registryRecordId: z.string().optional(),
  registryIdentifier: z.string().optional(),
})

const sequencePayload = z.looseObject({
  name: z.string().default(''),
  molecule: z.enum(['dna', 'rna', 'protein']).default('dna'),
  topology: topology.default('circular'),
  residues: z.string().default(''),
  features: z.array(feature).default([]),
  title: z.string().optional(),
  caption: z.string().optional(),
  registryRecordId: z.string().optional(),
  registryIdentifier: z.string().optional(),
  sourceFileRecordId: z.string().optional(),
  mapEnzymes: z.array(z.string()).optional(),
  digests: z
    .array(
      z.looseObject({
        enzymes: z.array(z.string()),
        ladder: z.enum(['1kb', '100bp']),
      }),
    )
    .optional(),
  primers: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        seq: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        strand: strand.optional(),
        note: z.string().optional(),
      }),
    )
    .optional(),
  plans: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        method: assemblyMethod,
        enzymes: z.array(z.string()),
        partEnzymes: z.record(z.string(), z.array(z.string())).optional(),
        partPick: z
          .record(
            z.string(),
            z.union([z.enum(['largest', 'smallest']), z.array(z.number())]),
          )
          .optional(),
        parts: z.array(part),
        minOverlap: z.number().optional(),
      }),
    )
    .optional(),
  reads: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        bases: z.string(),
        quality: z.string(),
        trace: z.string().optional(),
      }),
    )
    .optional(),
  products: z
    .array(
      z.looseObject({
        recordId: z.string(),
        identifier: z.string(),
        title: z.string(),
        method: assemblyMethod,
        planId: z.string().optional(),
        registeredAt: z.string(),
      }),
    )
    .optional(),
})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Persisted host state is parsed by sequencePayload before use.
export function parseSequencePayload(payload: unknown) {
  return sequencePayload.safeParse(payload ?? {})
}

/** A validated payload as the editors read it, with legacy defaults. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Persisted host state is parsed by sequencePayload before use.
export function sequenceOf(payload: unknown): SequenceBlockPayload {
  return sequencePayload.parse(payload ?? {})
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
  const read: StoredRead = {
    id: newId('read'),
    name,
    bases,
    quality: encodeQuality(quality),
  }

  if (trace) read.trace = trace

  return read
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
