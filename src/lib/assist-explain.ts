/**
 * ASSIST-01 — Contextual Help & Explain.
 *
 * Read-only, deterministic explanations assembled from canonical state:
 * validation kernels (blocks, scientific-records, plate-designer,
 * sheet-write-back), field definitions, provenance rows and version pins.
 * Every claim in an explanation carries a citation to the underlying
 * Sheetbase object or rule.
 *
 * Grounding order (facts primary, phrasing secondary):
 * 1. Local deterministic builders below — always available, always primary.
 * 2. `attachGrounding` merges AI-01 envelope sections and AI-02 citations
 *    as additional cited sources when the caller has assembled them.
 * 3. `stubPhraseExplanation` runs the AI-03 gateway stub over the
 *    explanation for model phrasing. The result is marked as assistance and
 *    MUST be rendered beside (never instead of) the grounded facts.
 *
 * Boundaries: no mutation path anywhere in this module. Explanations are
 * assistive, not authoritative — human review boundaries are unchanged.
 */

import type { AiContextEnvelope } from './ai-context'
import { StubModelProvider } from './ai-gateway'
import type { AiCitation } from './ai-retrieval'
import type { BlockValidationError } from './blocks'
import type { PlateDesignValidationError } from './plate-designer'
import type {
  PropertyValidationError,
  RecordFieldDefinition,
} from './scientific-records'

/**
 * Rendered beside every explanation. Assistance is distinguishable from
 * canonical state (PRODUCT.md:91): grounded facts first, model phrasing
 * clearly marked, never authoritative.
 */
export const ASSISTANCE_NOTE =
  'AI assistance — verify against the cited rules and provenance. ' +
  'Not authoritative; human review required before acting.'

/** Model used for stub phrasing. Must stay on the AI-03 gateway allowlist. */
export const ASSIST_STUB_MODEL = 'sheetbase-assist-1' as const

/** One cited source behind a claim. Labels name the rule or object. */
export interface AssistCitation {
  label: string
  detail: string
  deepLink?: string | null
}

/** A single grounded claim: what the rule says plus where it comes from. */
export interface AssistClaim {
  text: string
  citation: AssistCitation
}

export interface AssistExplanation {
  title: string
  whatFailed: string
  /** Why, one grounded claim per rule hit. Never empty when built. */
  why: AssistClaim[]
  /** How to resolve, in the user's own workspace terms. */
  howTo: string[]
  /** Every cited source, in claim order. */
  citations: AssistCitation[]
  /** Which canonical state the facts were assembled from. */
  groundedFrom: string
}

// ---------------------------------------------------------------------------
// Block validation (notebook validation errors).
// ---------------------------------------------------------------------------

const BLOCK_WHY: Record<BlockValidationError, string> = {
  unknown_block_type:
    'The block type is not in the known block vocabulary, so no payload shape can be checked against it.',
  unsupported_payload_schema_version:
    'The payload was written against a schema version this client does not validate, so its shape cannot be trusted.',
  invalid_payload_shape:
    'The payload is not the shape this block type requires (wrong JSON structure).',
  missing_required_field:
    'A field the block type requires is absent from the payload.',
  invalid_field_value:
    'A field is present but holds a value the block type rejects.',
}

const BLOCK_HOW_TO: Record<BlockValidationError, string> = {
  unknown_block_type:
    'Change the block to a supported type, or re-create it with the block picker.',
  unsupported_payload_schema_version:
    'Re-create the block with the current editor so the payload is rewritten at the supported schema version.',
  invalid_payload_shape:
    'Reset the block content with the type editor — editing raw JSON will not satisfy the shape check.',
  missing_required_field:
    'Fill in the named field in the block editor, then save again.',
  invalid_field_value:
    'Correct the named field to an accepted value in the block editor, then save again.',
}

export function explainBlockValidation(input: {
  blockType: string
  errors: Array<{ code: BlockValidationError; field?: string; message: string }>
}): AssistExplanation | null {
  if (input.errors.length === 0) return null
  const why: AssistClaim[] = input.errors.map((error) => ({
    text:
      `${(BLOCK_WHY as Record<string, string | undefined>)[error.code] ?? error.message}` +
      (error.field ? ` Field: '${error.field}'.` : ''),
    citation: {
      label: `Block rule ${error.code}`,
      detail:
        `blocks validation kernel · type '${input.blockType}'` +
        (error.field ? ` · field '${error.field}'` : '') +
        ` · ${error.message}`,
    },
  }))
  const howTo = input.errors.map(
    (error) =>
      (BLOCK_HOW_TO as Record<string, string | undefined>)[error.code] ??
      'Correct the flagged content and save again.',
  )
  return {
    title: `Why this ${input.blockType} block cannot save`,
    whatFailed: `The ${input.blockType} block failed validation: ${input.errors.length} problem${input.errors.length === 1 ? '' : 's'} must be fixed before it can save. Nothing was written.`,
    why,
    howTo: [...new Set(howTo)],
    citations: why.map((claim) => claim.citation),
    groundedFrom:
      'blocks validation kernel (validateBlock, BLOCK_TYPES, payload schema v1)',
  }
}

// ---------------------------------------------------------------------------
// Record property validation (record field rules).
// ---------------------------------------------------------------------------

function describeFieldRule(def: RecordFieldDefinition): string {
  const parts = [
    `type ${def.logicalType}`,
    def.nullable ? 'optional' : 'required',
  ]
  if (Array.isArray((def.validation as { enum?: unknown }).enum)) {
    parts.push(
      `allowed: ${(def.validation as { enum: unknown[] }).enum.join(', ')}`,
    )
  }
  return parts.join(' · ')
}

export function explainPropertyValidation(input: {
  kind: string
  errors: PropertyValidationError[]
  definitions: RecordFieldDefinition[]
}): AssistExplanation | null {
  if (input.errors.length === 0) return null
  const byField = new Map(input.definitions.map((def) => [def.fieldName, def]))
  const why: AssistClaim[] = input.errors.map((error) => {
    const def = byField.get(error.field)
    return {
      text: def
        ? `'${def.label}' failed its field rule (${describeFieldRule(def)}). ${error.message}`
        : error.message,
      citation: def
        ? {
            label: `Field rule ${def.fieldName}`,
            detail:
              `field definition '${def.label}' (${def.id}) · kind '${input.kind}'` +
              ` · ${describeFieldRule(def)}`,
          }
        : {
            label: `Field ${error.field}`,
            detail: `no active field definition for '${error.field}' in kind '${input.kind}' · ${error.message}`,
          },
    }
  })
  return {
    title: `Why this ${input.kind} record is invalid`,
    whatFailed: `${input.errors.length} field${input.errors.length === 1 ? '' : 's'} failed validation against the active field definitions for '${input.kind}'. Nothing was written.`,
    why,
    howTo: [
      'Edit the flagged fields to satisfy the cited rules, then save again.',
      'Values for retired or never-defined fields are preserved but cannot be validated — check the field still exists before relying on them.',
    ],
    citations: why.map((claim) => claim.citation),
    groundedFrom:
      'scientific-records validation kernel (validateProperties over active field definitions)',
  }
}

// ---------------------------------------------------------------------------
// Sheet write-back failures (pre-commit batch validation).
// ---------------------------------------------------------------------------

export interface SheetWriteBackFailure {
  code: string
  rowId?: string
  fieldId?: string
}

export function explainSheetWriteBack(input: {
  errors: SheetWriteBackFailure[]
  mixedAuthority?: boolean
}): AssistExplanation | null {
  if (input.mixedAuthority) {
    const citation: AssistCitation = {
      label: 'Write-back rule mixed_authority_write',
      detail:
        'sheet-write-back pre-commit guard · a range operation spanning more ' +
        'than one authoritative commit group is rejected before any write',
    }
    return {
      title: 'Why write-back was rejected',
      whatFailed:
        'The edit spans more than one authoritative target (multiple datasets, record groups, or a mix of dataset, record and local targets), so it was rejected before any write. Nothing was written.',
      why: [
        {
          text: 'Cross-authority atomicity is not available in one RPC: committing the groups in sequence could strand part of the edit behind a dangling pending state.',
          citation,
        },
      ],
      howTo: [
        'Split the edit so each range operation writes to one dataset, record, or local surface, then write back each part separately.',
        'Pending values are kept — nothing needs re-typing, only re-scoping.',
      ],
      citations: [citation],
      groundedFrom:
        'sheet-write-back pre-commit guard (SheetMixedAuthorityWriteError)',
    }
  }
  if (input.errors.length === 0) return null
  const why: AssistClaim[] = input.errors.map((error) => ({
    text:
      `The server rejected the batch at pre-commit validation (${error.code})` +
      (error.rowId ? ` on row '${error.rowId}'` : '') +
      (error.fieldId ? ` field '${error.fieldId}'` : '') +
      '. The failure is fail-closed: no partial state was committed.',
    citation: {
      label: `Write-back rule ${error.code}`,
      detail:
        'sheet-write-back pre-commit validation (validate_dataset_row_batch / commit_dataset_row_batch)' +
        (error.rowId ? ` · row '${error.rowId}'` : '') +
        (error.fieldId ? ` · field '${error.fieldId}'` : ''),
    },
  }))
  return {
    title: 'Why write-back was rejected',
    whatFailed: `The server rejected the batch before commit: ${input.errors[0]?.code ?? 'validation_failed'}. Nothing was written.`,
    why,
    howTo: [
      'Fix the flagged cells in the working view (the grid points at the offending row and field), then write back again.',
      'Pending values are kept — correct them in place rather than re-entering the edit.',
    ],
    citations: why.map((claim) => claim.citation),
    groundedFrom:
      'sheet-write-back pre-commit validation (SheetBatchValidationError, fail-closed commit)',
  }
}

// ---------------------------------------------------------------------------
// Plate design validation (plate inspector).
// ---------------------------------------------------------------------------

export function explainPlateValidation(input: {
  errors: PlateDesignValidationError[]
}): AssistExplanation | null {
  if (input.errors.length === 0) return null
  const why: AssistClaim[] = input.errors.map((error) => ({
    text:
      error.message +
      (error.wellCode && !error.message.includes(error.wellCode)
        ? ` Well: ${error.wellCode}.`
        : ''),
    citation: {
      label: `Plate rule ${error.code}`,
      detail:
        'plate-designer validation kernel (validatePlateDesign over plate-map spec)' +
        (error.wellCode ? ` · well ${error.wellCode}` : '') +
        (error.field ? ` · field '${error.field}'` : ''),
    },
  }))
  return {
    title: 'Why this plate design has issues',
    whatFailed: `${input.errors.length} design problem${input.errors.length === 1 ? '' : 's'} must be resolved before the plate can be used. Nothing was committed.`,
    why,
    howTo: [
      'Select each flagged well and correct the assignment (missing sample references, control placement, or volume) in the inspector, then save again.',
    ],
    citations: why.map((claim) => claim.citation),
    groundedFrom:
      'plate-designer validation kernel (validatePlateDesign over plate-map spec)',
  }
}

// ---------------------------------------------------------------------------
// Envelope + citation grounding (AI-01 / AI-02).
// ---------------------------------------------------------------------------

export interface AssistGrounding {
  envelope?: AiContextEnvelope | null
  citations?: AiCitation[] | null
}

/**
 * Merge AI-01 envelope sections and AI-02 citations into an explanation as
 * additional cited sources. Pure: returns a new explanation, never mutates
 * the input. Envelope objects resolve against citations by stable ID so the
 * deep link always names the canonical destination.
 */
export function attachGrounding(
  explanation: AssistExplanation,
  grounding: AssistGrounding,
): AssistExplanation {
  const extra: AssistCitation[] = []
  const byId = new Map(
    (grounding.citations ?? []).map((citation) => [
      citation.stableId,
      citation,
    ]),
  )
  for (const object of grounding.envelope?.objects ?? []) {
    const citation = byId.get(object.id)
    extra.push({
      label: `[${object.kind}:${object.id}] ${object.title}`,
      detail:
        `context envelope v${grounding.envelope?.version ?? '?'} · freshness ${object.freshness}` +
        (object.pins.length > 0
          ? ` · pins ${object.pins.map((pin) => `${pin.kind}:${pin.id}`).join(', ')}`
          : ' · live') +
        ` · sections ${object.sections.map((section) => section.heading).join(', ') || 'none'}`,
      deepLink: citation?.deepLink ?? object.deepLink,
    })
  }
  for (const citation of grounding.citations ?? []) {
    if (
      grounding.envelope?.objects.some(
        (object) => object.id === citation.stableId,
      )
    )
      continue
    extra.push({
      label: `[${citation.kind}:${citation.stableId}] ${citation.title}`,
      detail:
        `retrieval citation · matched ${citation.matchedField}` +
        (citation.archived ? ' · archived' : ''),
      deepLink: citation.deepLink,
    })
  }
  if (extra.length === 0) return explanation
  return {
    ...explanation,
    why: explanation.why,
    howTo: explanation.howTo,
    citations: [...explanation.citations, ...extra],
  }
}

// ---------------------------------------------------------------------------
// Gateway stub phrasing (AI-03). Marked assistance, never the facts.
// ---------------------------------------------------------------------------

export interface AssistPhrasing {
  text: string
  model: typeof ASSIST_STUB_MODEL
  /** Always true: stub phrasing is assistance, rendered beside the facts. */
  assistance: true
}

/**
 * Phrase an explanation through the AI-03 gateway stub. Deterministic in
 * tests (no network, no credentials): the stub echoes the citation labels
 * it was given. The result MUST be rendered with ASSISTANCE_NOTE beside
 * the grounded facts — never instead of them.
 */
export async function stubPhraseExplanation(
  explanation: AssistExplanation,
): Promise<AssistPhrasing> {
  const provider = new StubModelProvider(
    ASSIST_STUB_MODEL,
    'Explanation phrasing',
  )
  const response = await provider.complete({
    prompt: [explanation.title, explanation.whatFailed]
      .concat(explanation.why.map((claim) => claim.text))
      .join('\n'),
    maxTokens: 500,
    citationIds: explanation.citations.map((citation) => citation.label),
  })
  return { text: response.text, model: ASSIST_STUB_MODEL, assistance: true }
}
