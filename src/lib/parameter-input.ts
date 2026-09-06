import type { Parameter } from '#/lib/parameter'
import { scalarParameterValueSchema } from '#/lib/parameter'

export type ScalarParameterDraft = Partial<Record<string, string>>

export function parseScalarParameterValue(
  parameter: Parameter,
  rawValue: string | undefined,
): unknown {
  if (parameter.type.kind !== 'scalar')
    throw new Error('Only scalar parameters can be parsed here.')
  const trimmed = rawValue?.trim() ?? ''
  const hasInput = trimmed.length > 0
  const value = hasInput ? trimmed : parameter.defaultValue
  if (value === undefined) {
    if (parameter.required)
      throw new Error(`Parameter "${parameter.label}" is required.`)
    return undefined
  }
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (
      parameter.type.valueType === 'integer' ||
      parameter.type.valueType === 'decimal'
    ) {
      parsed = Number(value)
    } else if (parameter.type.valueType === 'boolean') {
      const normalised = value.toLowerCase()
      if (normalised === 'true') parsed = true
      else if (normalised === 'false') parsed = false
    }
  }
  if (
    !scalarParameterValueSchema(parameter.type.valueType).safeParse(parsed)
      .success
  ) {
    throw new Error(`Parameter "${parameter.label}" has an invalid value.`)
  }
  if (typeof parsed === 'number') {
    if (
      parameter.constraints.min !== undefined &&
      parsed < parameter.constraints.min
    ) {
      throw new Error(
        `Parameter "${parameter.label}" is below the minimum value.`,
      )
    }
    if (
      parameter.constraints.max !== undefined &&
      parsed > parameter.constraints.max
    ) {
      throw new Error(
        `Parameter "${parameter.label}" exceeds the maximum value.`,
      )
    }
  }
  if (typeof parsed === 'string') {
    if (
      parameter.constraints.minLength !== undefined &&
      parsed.length < parameter.constraints.minLength
    ) {
      throw new Error(`Parameter "${parameter.label}" is too short.`)
    }
    if (
      parameter.constraints.maxLength !== undefined &&
      parsed.length > parameter.constraints.maxLength
    ) {
      throw new Error(`Parameter "${parameter.label}" is too long.`)
    }
    if (
      parameter.constraints.pattern !== undefined &&
      !new RegExp(parameter.constraints.pattern).test(parsed)
    ) {
      throw new Error(
        `Parameter "${parameter.label}" does not match the expected format.`,
      )
    }
  }
  if (
    parameter.constraints.allowedValues !== undefined &&
    !parameter.constraints.allowedValues.some((allowed) => allowed === parsed)
  ) {
    throw new Error(`Parameter "${parameter.label}" is not an allowed value.`)
  }
  return parsed
}

/**
 * Visible default drafts for scalar parameters: the instantiate UI pre-fills
 * these so declared defaults are shown and overridable, never silently
 * substituted at another layer. Non-scalar parameters cannot declare
 * defaults, so they contribute nothing here.
 */
export function defaultParameterDrafts(
  parameters: Parameter[],
): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const parameter of parameters) {
    if (parameter.type.kind !== 'scalar') continue
    if (parameter.defaultValue === undefined) continue
    drafts[parameter.id] =
      typeof parameter.defaultValue === 'string'
        ? parameter.defaultValue
        : String(parameter.defaultValue)
  }
  return drafts
}

/** Display text for a scalar parameter's declared default, if any. */
export function scalarDefaultText(parameter: Parameter): string | null {
  if (parameter.type.kind !== 'scalar') return null
  if (parameter.defaultValue === undefined) return null
  return typeof parameter.defaultValue === 'string'
    ? parameter.defaultValue
    : String(parameter.defaultValue)
}

export type ParameterInputWire =
  | { parameterId: string; kind: 'scalar'; value: unknown }
  | { parameterId: string; kind: 'record'; recordId: string }
  | { parameterId: string; kind: 'dataset'; datasetId: string }
  | { parameterId: string; kind: 'dataset-version'; datasetVersionId: string }

export function buildParameterInputs(
  parameters: Parameter[],
  drafts: ScalarParameterDraft,
): ParameterInputWire[] {
  return parameters
    .map((parameter): ParameterInputWire | null => {
      const raw = drafts[parameter.id]
      if (parameter.type.kind === 'scalar') {
        const parsed = parseScalarParameterValue(parameter, raw)
        if (parsed === undefined) return null
        return { parameterId: parameter.id, kind: 'scalar', value: parsed }
      }
      const value = (raw ?? '').trim()
      if (!value && parameter.required)
        throw new Error(`Parameter "${parameter.label}" is required.`)
      if (!value && !parameter.required) return null
      if (parameter.type.kind === 'record')
        return { parameterId: parameter.id, kind: 'record', recordId: value }
      if (parameter.type.kind === 'dataset')
        return { parameterId: parameter.id, kind: 'dataset', datasetId: value }
      return {
        parameterId: parameter.id,
        kind: 'dataset-version',
        datasetVersionId: value,
      }
    })
    .filter((item): item is ParameterInputWire => item !== null)
}
