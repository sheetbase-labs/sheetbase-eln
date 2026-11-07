import { z } from 'zod'

import {
  SEQUENCE_TOOL_NAME,
  runSequenceTool,
  sequenceToolSchema,
} from '../molbio/tools'
import type { SequenceToolResult } from '../molbio/tools'

/**
 * MCP face of the molecular biology calculations: restriction sites, digests,
 * primer design and checks, PCR, cloning products, alignment and Sanger read
 * checks on sequences the caller sends. Pure computation, nothing is read or
 * written, so any read credential may call it. Sequence blocks themselves are
 * ordinary notebook blocks, read with `sheetbase.canonical.read` and changed
 * through the block proposal tools.
 */
export { SEQUENCE_TOOL_NAME }

/**
 * What clients are shown: one flat object, because providers refuse a union at
 * the top of a tool schema. `sequenceToolSchema` still checks each action's
 * own arguments when the call arrives.
 */
const advertisedSchema = z
  .object({
    action: z.enum([
      'sites',
      'digest',
      'annotate',
      'primers',
      'check_primer',
      'pcr',
      'assemble',
      'align',
      'crispr',
      'codon_optimise',
      'check_read',
    ]),
    sequence: z
      .string()
      .optional()
      .describe('DNA to analyse (sites, digest, annotate, primers).'),
    topology: z
      .enum(['linear', 'circular'])
      .optional()
      .describe('Default circular.'),
    enzymes: z
      .array(z.string())
      .optional()
      .describe('Enzyme names (sites, digest).'),
    uniqueOnly: z
      .boolean()
      .optional()
      .describe('sites: only enzymes that cut once.'),
    start: z
      .number()
      .int()
      .optional()
      .describe('primers: first base of the region, 1-based.'),
    end: z
      .number()
      .int()
      .optional()
      .describe('primers: last base of the region, 1-based.'),
    targetTm: z
      .number()
      .optional()
      .describe('primers: wanted melting temperature, °C.'),
    maxProduct: z
      .number()
      .int()
      .optional()
      .describe('primers: longest product, bp.'),
    forwardTail: z
      .string()
      .optional()
      .describe('primers: 5′ tail for the forward primer.'),
    reverseTail: z
      .string()
      .optional()
      .describe('primers: 5′ tail for the reverse primer.'),
    primer: z
      .string()
      .optional()
      .describe('check_primer: the primer, 5′ to 3′.'),
    template: z.string().optional().describe('pcr: the template.'),
    forward: z.string().optional().describe('pcr: forward primer.'),
    reverse: z.string().optional().describe('pcr: reverse primer.'),
    method: z
      .enum(['ligation', 'golden_gate', 'gibson'])
      .optional()
      .describe('assemble: how to join.'),
    enzyme: z
      .string()
      .optional()
      .describe('assemble, Golden Gate: the Type IIS enzyme.'),
    parts: z
      .array(
        z.object({
          name: z.string(),
          sequence: z.string(),
          topology: z.enum(['linear', 'circular']).optional(),
          enzymes: z.array(z.string()).optional(),
          pick: z
            .union([z.enum(['largest', 'smallest']), z.array(z.number().int())])
            .optional(),
        }),
      )
      .optional()
      .describe('assemble: the parts, up to 12.'),
    nuclease: z
      .enum(['spcas9', 'sacas9', 'cas12a'])
      .optional()
      .describe('crispr: default spcas9.'),
    limit: z
      .number()
      .int()
      .optional()
      .describe(
        'crispr: most guides to return, default 20. Use start and end to limit the region.',
      ),
    input: z
      .enum(['dna', 'protein'])
      .optional()
      .describe('codon_optimise: what `sequence` is.'),
    host: z
      .enum(['ecoli', 'human', 'yeast'])
      .optional()
      .describe('codon_optimise: the host organism.'),
    avoidEnzymes: z
      .array(z.string())
      .optional()
      .describe('codon_optimise: enzymes whose sites must not appear.'),
    maxRun: z
      .number()
      .int()
      .optional()
      .describe(
        'codon_optimise: break single-base runs this long (default 6).',
      ),
    reference: z.string().optional().describe('align: the reference.'),
    query: z.string().optional().describe('align: the query.'),
    mode: z
      .enum(['global', 'local'])
      .optional()
      .describe('align: default local.'),
    expected: z
      .string()
      .optional()
      .describe('check_read: the expected construct.'),
    read: z.string().optional().describe('check_read: the read bases.'),
    quality: z
      .string()
      .optional()
      .describe('check_read: Phred+33 string, one character per base.'),
  })
  .strict()

export function sequenceTool() {
  return {
    name: SEQUENCE_TOOL_NAME,
    description:
      'Do molecular biology on DNA the caller supplies. `action` is one of: sites (restriction map, optional enzyme list or unique cutters), digest (fragments and gel bands for chosen enzymes), annotate (common features and ORFs), primers (design primer pairs for a 1-based region), check_primer (Tm, GC, hairpin, dimer), pcr (products of a primer pair on a template), assemble (digest and ligate, Golden Gate or Gibson products of parts), align (global or local alignment) and crispr (guide RNAs for SpCas9, SaCas9 or Cas12a with a GC, terminator and near-match screen), codon_optimise (re-code a coding sequence or protein for E. coli, human or yeast, avoiding chosen enzyme sites and long runs) and check_read (Sanger read against the expected construct). Positions in results are 1-based unless a field says otherwise. Read-only; nothing is stored.',
    inputSchema: z.toJSONSchema(advertisedSchema, { io: 'input' }),
    annotations: {
      title: 'Analyse DNA sequences',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }
}

/** Validate and run one calculation. */
export function callSequenceTool(input: unknown): SequenceToolResult {
  const parsed = sequenceToolSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first.path.join('.') || 'arguments'
    return {
      ok: false,
      result: `Invalid arguments: ${where}: ${first.message}.`,
    }
  }
  try {
    return runSequenceTool(parsed.data)
  } catch (error) {
    return {
      ok: false,
      result:
        error instanceof Error ? error.message : 'The calculation failed.',
    }
  }
}
