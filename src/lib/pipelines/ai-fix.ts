import { z } from 'zod'
import { extractJsonObject } from '../ai-import-mapping'
import { validatePipelineConfig } from './config'
import type { PipelineConfig } from './config'

/**
 * AI help for a failed pipeline run. The model reads what failed (the error,
 * the log, the step that stopped) and answers with a plain explanation plus,
 * when a code change would fix it, one corrected statement for one step.
 *
 * Nothing here writes. `applyStepFix` only builds the configuration a draft
 * version would hold; the page saves it through the ordinary draft calls and
 * the pipeline is never published by this path.
 */

export interface RunFailureFacts {
  errorCode: string | null
  errorMessage: string | null
  /** The last error-level log lines, oldest first. */
  logLines: string[]
  /** The step the run stopped on, when it could be told. */
  failedStep: string | null
  config: Partial<PipelineConfig>
}

export interface StepFix {
  explanation: string
  /** The name of a SQL or Python step of the version. */
  target: string
  language: 'sql' | 'python'
  statement: string
}

export interface FailureExplanation {
  explanation: string
  fix: StepFix | null
}

const MAX_LOG_LINES = 12
const MAX_STATEMENT_CHARS = 6_000

const failureReply = z.object({
  explanation: z.string().catch(''),
  fix: z
    .object({
      target: z.string().catch(''),
      statement: z.string().catch(''),
      language: z.enum(['sql', 'python']),
    })
    .nullable()
    .catch(null),
})

function codeSteps(config: Partial<PipelineConfig>) {
  return (config.steps ?? []).flatMap((step) =>
    step.kind === 'sql' || step.kind === 'python'
      ? [{ name: step.name, language: step.kind, statement: step.statement }]
      : [],
  )
}

function stepStatements(config: Partial<PipelineConfig>): string[] {
  // Only SQL and Python steps hold code to fix.
  return codeSteps(config).map(
    (step) =>
      `Step "${step.name}" (${step.language}):\n${step.statement.slice(0, MAX_STATEMENT_CHARS)}`,
  )
}

/** The statement currently held by a target, or null when it does not exist. */
export function statementOf(
  config: Partial<PipelineConfig>,
  target: string,
): { language: 'sql' | 'python'; statement: string } | null {
  const step = codeSteps(config).find((candidate) => candidate.name === target)

  return step ? { language: step.language, statement: step.statement } : null
}

export const FIX_INSTRUCTION = [
  'A pipeline run failed. Explain why in plain language for a bench scientist and, only when changing one step’s code would fix it, give the corrected statement for that one step.',
  'Use only the facts supplied. Do not invent table, column or parameter names that are not in the supplied statements, inputs or log.',
  'If the cause is not in the code (missing input, timeout, quota, permissions), give no fix.',
  'Reply with JSON only, no code fences, in exactly this shape:',
  '{"explanation": "2-4 short sentences", "fix": null}',
  'or',
  '{"explanation": "2-4 short sentences", "fix": {"target": "<step name from the supplied steps>", "language": "sql" | "python", "statement": "<the full corrected statement>"}}',
].join('\n')

/** The text half of the prompt: what failed, with the code that ran. */
export function buildFixText(facts: RunFailureFacts): string {
  const parts = [
    `Error code: ${facts.errorCode ?? 'none'}`,
    `Error message: ${facts.errorMessage ?? 'none recorded'}`,
  ]

  if (facts.failedStep) parts.push(`Stopped on: ${facts.failedStep}`)
  const lines = facts.logLines.slice(-MAX_LOG_LINES)

  if (lines.length) parts.push(`Error log:\n${lines.join('\n')}`)
  const inputs = (facts.config.inputs ?? []).map((input) => input.name)

  if (inputs.length) parts.push(`Inputs: ${inputs.join(', ')}`)

  const parameters = (facts.config.parameters ?? []).map(
    (parameter) => `${parameter.name} (${parameter.type})`,
  )

  if (parameters.length) parts.push(`Parameters: ${parameters.join(', ')}`)
  parts.push(...stepStatements(facts.config))

  return parts.join('\n\n')
}

/**
 * Read the model's reply. Anything that is not the agreed shape, or that
 * targets a step the pipeline does not have, comes back as an explanation
 * only. Plain prose is kept as the explanation so a chatty model still helps.
 */
export function parseFailureReply(
  text: string,
  config: Partial<PipelineConfig>,
): FailureExplanation | null {
  const raw = text.trim()

  if (!raw) return null
  const parsed = failureReply.safeParse(extractJsonObject(raw))

  if (!parsed.success) {
    return { explanation: raw, fix: null }
  }

  const explanation = parsed.data.explanation.trim()

  if (!explanation) return null
  const f = parsed.data.fix

  if (f === null) return { explanation, fix: null }
  const target = f.target
  const statement = f.statement.trim()
  const current = statementOf(config, target)

  if (
    !current ||
    !statement ||
    statement.length > MAX_STATEMENT_CHARS * 3 ||
    // The fix may rewrite a step but never change what language it runs in.
    f.language !== current.language ||
    statement === current.statement.trim()
  ) {
    return { explanation, fix: null }
  }

  return {
    explanation,
    fix: { explanation, target, language: current.language, statement },
  }
}

/**
 * The configuration a draft would hold with the fix applied, or the problems
 * that stop it from being a valid pipeline. The base is the draft when one
 * exists (so work already in it is kept), otherwise the version that failed.
 */
const draftObjectEnvelope = z.looseObject({})

const draftObject = z.custom<z.infer<typeof draftObjectEnvelope>>(
  (value) => draftObjectEnvelope.safeParse(value).success,
)

const fixedConfiguration = z.custom<PipelineConfig>(
  (value) => validatePipelineConfig(value).length === 0,
  {
    error: (issue) =>
      validatePipelineConfig(issue.input)[0]?.message ??
      'Not a valid pipeline.',
  },
)

export function applyStepFix(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Saved drafts enter here as raw input; decode their shape before applying the correction and validate the resulting configuration.
  base: unknown,
  fix: StepFix,
): { ok: true; config: PipelineConfig } | { ok: false; reason: string } {
  const decoded = draftObject.safeParse(base)

  if (!decoded.success)
    return {
      ok: false,
      reason:
        validatePipelineConfig(base)[0]?.message ?? 'Not a valid pipeline.',
    }

  const draft = structuredClone(decoded.data)

  // Older drafts may omit the empty lists; they mean the same as empty.
  draft.parameters ??= []
  draft.inputs ??= []

  const steps = z.array(draftObject).safeParse(draft.steps ?? [])

  if (!steps.success)
    return {
      ok: false,
      reason:
        validatePipelineConfig(draft)[0]?.message ?? 'Not a valid pipeline.',
    }

  const step = steps.data.find((candidate) => candidate.name === fix.target)

  if (!step || (step.kind !== 'sql' && step.kind !== 'python')) {
    return {
      ok: false,
      reason: `The draft has no step called ${fix.target}.`,
    }
  }

  step.statement = fix.statement
  draft.steps = steps.data

  const result = fixedConfiguration.safeParse(draft)

  return result.success
    ? { ok: true, config: result.data }
    : {
        ok: false,
        reason: result.error.issues[0]?.message ?? 'Not a valid pipeline.',
      }
}
