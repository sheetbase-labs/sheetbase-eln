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

/** The transform is addressed as this target; any other target is a step name. */
export const TRANSFORM_TARGET = 'transform'

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
  /** 'transform' or the name of a declared step. */
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

function stepStatements(config: Partial<PipelineConfig>): string[] {
  const out: string[] = []
  const transform = config.transform

  if (transform && transform.language !== 'none' && transform.statement) {
    out.push(
      `Step "${TRANSFORM_TARGET}" (${transform.language}):\n${transform.statement.slice(0, MAX_STATEMENT_CHARS)}`,
    )
  }

  for (const step of config.steps ?? []) {
    // A plugin step has no code to fix.
    if (step.language === 'plugin') continue
    out.push(
      `Step "${step.name}" (${step.language}):\n${step.statement.slice(0, MAX_STATEMENT_CHARS)}`,
    )
  }

  return out
}

/** The statement currently held by a target, or null when it does not exist. */
export function statementOf(
  config: Partial<PipelineConfig>,
  target: string,
): { language: 'sql' | 'python'; statement: string } | null {
  if (target === TRANSFORM_TARGET) {
    const transform = config.transform

    if (!transform || transform.language === 'none') return null

    return { language: transform.language, statement: transform.statement }
  }

  const step = config.steps?.find((candidate) => candidate.name === target)

  return step && step.language !== 'plugin'
    ? { language: step.language, statement: step.statement }
    : null
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
  const value = extractJsonObject(raw)

  if (typeof value !== 'object' || value === null) {
    return { explanation: raw, fix: null }
  }

  const record = value as Record<string, unknown>

  const explanation =
    typeof record.explanation === 'string' ? record.explanation.trim() : ''

  if (!explanation) return null
  const fix = record.fix

  if (typeof fix !== 'object' || fix === null) return { explanation, fix: null }
  const f = fix as Record<string, unknown>
  const target = typeof f.target === 'string' ? f.target : ''
  const statement = typeof f.statement === 'string' ? f.statement.trim() : ''
  const current = statementOf(config, target)

  if (
    !current ||
    !statement ||
    statement.length > MAX_STATEMENT_CHARS * 3 ||
    (f.language !== 'sql' && f.language !== 'python') ||
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
export function applyStepFix(
  base: PipelineConfig,
  fix: StepFix,
): { ok: true; config: PipelineConfig } | { ok: false; reason: string } {
  const config: PipelineConfig = structuredClone(base)
  // Older drafts may omit the empty lists; they mean the same as empty.
  const lists = config as Partial<PipelineConfig>
  lists.parameters ??= []
  lists.inputs ??= []

  if (fix.target === TRANSFORM_TARGET) {
    if (config.transform.language === 'none') {
      return { ok: false, reason: 'The draft has no transform to correct.' }
    }

    config.transform = { ...config.transform, statement: fix.statement }
  } else {
    const step = config.steps?.find(
      (candidate) => candidate.name === fix.target,
    )

    if (!step) {
      return {
        ok: false,
        reason: `The draft has no step called ${fix.target}.`,
      }
    }

    step.statement = fix.statement
  }

  const errors = validatePipelineConfig(config)

  if (errors.length) {
    return { ok: false, reason: errors[0]?.message ?? 'Not a valid pipeline.' }
  }

  return { ok: true, config }
}
