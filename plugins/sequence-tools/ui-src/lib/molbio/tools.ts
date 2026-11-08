/**
 * The molecular biology calculations as one tool an assistant or an outside
 * agent can call: restriction sites, digests, primer design and checks, PCR,
 * cloning products, alignment and Sanger read checks. It is pure computation:
 * nothing is read from or written to the workspace, so it needs no more access
 * than reading does.
 */
import { z } from 'zod'

import { alignPair } from './align'
import { autoAnnotate } from './annotate'
import { digestAndLigate, gibson, goldenGate } from './assembly'
import { cleanDna } from './dna'
import { NUCLEASES, findGuides, nucleaseByKey } from './crispr'
import { HOSTS, optimiseCodons } from './codon'
import { digest, formatBp, gelBands, mapSites } from './digest'
import { analysePrimer, designPrimers, simulatePcr } from './primers'
import { checkRead } from './sanger'
import { decodeQuality } from './abif'

export const SEQUENCE_TOOL_NAME = 'sheetbase.sequence.analyse'

/** Longest sequence the tool takes, in bases. */
export const TOOL_MAX_BASES = 400_000
const SHOWN_BASES = 20_000

const bases = z
  .string()
  .min(1)
  .max(TOOL_MAX_BASES * 2)
  .describe('DNA letters; spaces, digits and a FASTA header line are ignored.')
const topology = z.enum(['linear', 'circular']).default('circular')
const enzymes = z
  .array(z.string().min(1).max(40))
  .max(30)
  .describe('Enzyme names such as EcoRI, BsaI.')

const part = z
  .object({
    name: z.string().min(1).max(120),
    sequence: bases,
    topology: z.enum(['linear', 'circular']).default('linear'),
    enzymes: enzymes
      .optional()
      .describe('Digest and ligate only: the enzymes that cut this part.'),
    pick: z
      .union([
        z.enum(['largest', 'smallest']),
        z.array(z.number().int().min(0).max(100)),
      ])
      .optional()
      .describe(
        'Digest and ligate only: which fragment to use, by position largest first (0 is the largest), or "largest" / "smallest".',
      ),
  })
  .strict()

export const sequenceToolSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('sites'),
      sequence: bases,
      topology,
      enzymes: enzymes.optional(),
      uniqueOnly: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('digest'),
      sequence: bases,
      topology,
      enzymes: enzymes.min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('annotate'),
      sequence: bases,
      topology,
    })
    .strict(),
  z
    .object({
      action: z.literal('primers'),
      sequence: bases,
      topology,
      start: z
        .number()
        .int()
        .min(1)
        .describe('First base of the region, 1-based.'),
      end: z
        .number()
        .int()
        .min(1)
        .describe('Last base of the region, 1-based.'),
      targetTm: z.number().min(40).max(80).optional(),
      maxProduct: z.number().int().min(50).max(20_000).optional(),
      forwardTail: z.string().max(80).optional(),
      reverseTail: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('check_primer'),
      primer: z.string().min(2).max(200),
      template: bases.optional(),
      topology,
    })
    .strict(),
  z
    .object({
      action: z.literal('pcr'),
      template: bases,
      topology,
      forward: z.string().min(10).max(200),
      reverse: z.string().min(10).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('assemble'),
      method: z.enum(['ligation', 'golden_gate', 'gibson']),
      parts: z.array(part).min(1).max(12),
      enzyme: z
        .string()
        .max(40)
        .optional()
        .describe('Golden Gate: the Type IIS enzyme, such as BsaI.'),
    })
    .strict(),
  z
    .object({
      action: z.literal('align'),
      reference: bases,
      query: bases,
      mode: z.enum(['global', 'local']).default('local'),
    })
    .strict(),
  z
    .object({
      action: z.literal('crispr'),
      sequence: bases,
      topology,
      nuclease: z.enum(['spcas9', 'sacas9', 'cas12a']).default('spcas9'),
      start: z.number().int().min(1).optional(),
      end: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('codon_optimise'),
      sequence: bases.describe('A coding sequence (DNA) or a protein.'),
      input: z.enum(['dna', 'protein']),
      host: z.enum(['ecoli', 'human', 'yeast']),
      avoidEnzymes: enzymes.optional(),
      maxRun: z.number().int().min(0).max(20).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('check_read'),
      expected: bases,
      topology,
      read: bases.describe('The Sanger read bases.'),
      quality: z
        .string()
        .max(TOOL_MAX_BASES)
        .optional()
        .describe(
          'Phred scores as a string, one character per base (score + 33). Leave out to treat every base as Q40.',
        ),
    })
    .strict(),
])

export type SequenceToolInput = z.infer<typeof sequenceToolSchema>

export interface SequenceToolResult {
  ok: boolean
  /** A JSON-friendly result, or a message when `ok` is false. */
  result: unknown
}

function clean(raw: string): string {
  // A FASTA header line is a name, not bases.
  const body = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('')
  return cleanDna(body)
}

function show(seq: string): { seq?: string; length: number } {
  return seq.length <= SHOWN_BASES
    ? { seq, length: seq.length }
    : { length: seq.length }
}

function tooLong(...seqs: string[]): boolean {
  return seqs.some((s) => s.length > TOOL_MAX_BASES)
}

const fail = (message: string): SequenceToolResult => ({
  ok: false,
  result: message,
})

/** Run one calculation. Input must already have passed `sequenceToolSchema`. */
export function runSequenceTool(input: SequenceToolInput): SequenceToolResult {
  switch (input.action) {
    case 'sites': {
      const seq = clean(input.sequence)
      if (tooLong(seq)) return fail('That sequence is too long.')
      const sites = mapSites(seq, input.topology, input.enzymes)
        .filter((s) =>
          input.uniqueOnly ? s.cuts.length === 1 : s.cuts.length > 0,
        )
        .map((s) => ({
          enzyme: s.enzyme.name,
          site: s.enzyme.site,
          cuts: s.cuts.length,
          positions: s.cuts.slice(0, 20).map((c) => c.top),
        }))
      return { ok: true, result: { length: seq.length, sites } }
    }
    case 'digest': {
      const seq = clean(input.sequence)
      if (tooLong(seq)) return fail('That sequence is too long.')
      const pieces = digest(seq, input.topology, input.enzymes)
      return {
        ok: true,
        result: {
          fragments: pieces.map((f) => ({
            start: f.start + 1,
            size: f.size,
            label: formatBp(f.size),
            leftEnd: { enzyme: f.leftEnzyme, ...f.left },
            rightEnd: { enzyme: f.rightEnzyme, ...f.right },
          })),
          gelBands: gelBands(pieces.map((f) => f.size)).map((b) => ({
            size: b.size,
            count: b.count,
          })),
        },
      }
    }
    case 'annotate': {
      const seq = clean(input.sequence)
      if (tooLong(seq)) return fail('That sequence is too long.')
      return {
        ok: true,
        result: autoAnnotate(seq, input.topology, []).map((f) => ({
          label: f.label,
          type: f.type,
          start: f.start,
          end: f.end,
          strand: f.strand,
        })),
      }
    }
    case 'primers': {
      const seq = clean(input.sequence)
      if (tooLong(seq)) return fail('That sequence is too long.')
      if (input.end < input.start || input.end > seq.length)
        return fail('The region must lie inside the sequence.')
      const pairs = designPrimers(
        seq,
        { start: input.start - 1, end: input.end },
        {
          ...(input.targetTm ? { optTm: input.targetTm } : {}),
          ...(input.maxProduct ? { maxProduct: input.maxProduct } : {}),
        },
      )
      const fwTail = clean(input.forwardTail ?? '')
      const rvTail = clean(input.reverseTail ?? '')
      return {
        ok: true,
        result: pairs.map((p) => ({
          forward: {
            seq: fwTail + p.forward.seq,
            tm: p.forward.tm,
            gc: p.forward.gc,
          },
          reverse: {
            seq: rvTail + p.reverse.seq,
            tm: p.reverse.tm,
            gc: p.reverse.gc,
          },
          productSize: p.productSize,
          tmDiff: p.tmDiff,
          warnings: p.warnings,
        })),
      }
    }
    case 'check_primer': {
      const primer = clean(input.primer)
      const report = analysePrimer(primer)
      return {
        ok: true,
        result: {
          length: report.length,
          tm: report.tm,
          gc: report.gc,
          gcClamp: report.gcClamp,
          hairpinDeltaG: report.hairpin.deltaG,
          selfDimerDeltaG: report.selfDimer.deltaG,
          warnings: report.warnings,
        },
      }
    }
    case 'pcr': {
      const template = clean(input.template)
      if (tooLong(template)) return fail('That template is too long.')
      const products = simulatePcr(
        template,
        clean(input.forward),
        clean(input.reverse),
        input.topology === 'circular',
      )
      return {
        ok: true,
        result: products.map((p) => ({
          start: p.start + 1,
          end: p.end,
          size: p.size,
          ...show(p.seq),
        })),
      }
    }
    case 'assemble': {
      const parts = input.parts.map((p, i) => ({
        id: `p${i + 1}`,
        name: p.name,
        seq: clean(p.sequence),
        topology: p.topology,
        enzymes: p.enzymes,
        pick: p.pick,
      }))
      if (parts.some((p) => tooLong(p.seq))) return fail('A part is too long.')
      let out: ReturnType<typeof gibson>
      if (input.method === 'gibson') {
        out = gibson(parts)
      } else if (input.method === 'golden_gate') {
        if (!input.enzyme) return fail('Golden Gate needs an enzyme.')
        out = goldenGate(parts, input.enzyme)
      } else {
        out = digestAndLigate(
          parts.map((p) => ({
            part: p,
            enzymes: p.enzymes ?? [],
            pick: p.pick ?? 'largest',
          })),
        )
      }
      return {
        ok: true,
        result: {
          warnings: out.warnings,
          products: out.products.map((p) => ({
            method: p.method,
            topology: p.topology,
            ...show(p.seq),
            parts: p.parts.map((x) => ({
              name: x.name,
              strand: x.strand,
              start: x.start,
              end: x.end,
            })),
            junctions: p.junctions,
            warnings: p.warnings,
          })),
        },
      }
    }
    case 'align': {
      const a = clean(input.reference)
      const b = clean(input.query)
      if (tooLong(a, b) || a.length * b.length > 25_000_000)
        return fail('Those sequences are too long to align here.')
      const r = alignPair(a, b, { mode: input.mode })
      return {
        ok: true,
        result: {
          score: r.score,
          identity: r.identity,
          matches: r.matches,
          mismatches: r.mismatches,
          gaps: r.gaps,
          reference: { start: r.aStart + 1, end: r.aEnd },
          query: { start: r.bStart + 1, end: r.bEnd },
        },
      }
    }
    case 'crispr': {
      const seq = clean(input.sequence)
      if (tooLong(seq)) return fail('That sequence is too long.')
      const nuclease = nucleaseByKey(input.nuclease) ?? NUCLEASES[0]
      const region =
        input.start !== undefined && input.end !== undefined
          ? { start: input.start, end: input.end }
          : undefined
      return {
        ok: true,
        result: {
          nuclease: nuclease.name,
          note: 'A screen of GC, terminators and near matches inside this sequence only; check the genome before ordering.',
          guides: findGuides(seq, input.topology, nuclease, {
            region,
            limit: input.limit,
          }),
        },
      }
    }
    case 'codon_optimise': {
      const raw = clean(input.sequence)
      const text =
        input.input === 'protein'
          ? input.sequence.toUpperCase().replace(/[^A-Z*]/g, '')
          : raw
      if (text.length === 0 || text.length > TOOL_MAX_BASES)
        return fail('Give a coding sequence or protein of a sensible length.')
      if (input.input === 'dna' && raw.length % 3 !== 0)
        return fail('A coding sequence must be a whole number of codons.')
      try {
        const r = optimiseCodons(
          input.input === 'protein' ? { protein: text } : { dna: raw },
          {
            host: input.host,
            avoidEnzymes: input.avoidEnzymes,
            maxRun: input.maxRun,
          },
        )
        return {
          ok: true,
          result: {
            host: HOSTS.find((h) => h.key === input.host)?.name,
            ...r,
          },
        }
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Could not optimise.')
      }
    }
    case 'check_read': {
      const expected = clean(input.expected)
      const read = clean(input.read)
      if (tooLong(expected, read)) return fail('That sequence is too long.')
      const quality = input.quality
        ? decodeQuality(input.quality)
        : new Array<number>(read.length).fill(40)
      if (quality.length !== read.length)
        return fail('The quality string must have one character per base.')
      const c = checkRead(expected, input.topology, [], {
        name: 'read',
        bases: read,
        quality,
      })
      return {
        ok: true,
        result: {
          verdict: c.verdict,
          strand: c.strand,
          covers: c.covers,
          identity: c.identity,
          meanQuality: c.meanQuality,
          differences: c.differences.slice(0, 50).map((d) => ({
            kind: d.kind,
            position: d.position,
            expected: d.expected,
            found: d.found,
            quality: d.quality,
            confirmed: d.confirmed,
          })),
        },
      }
    }
  }
}
