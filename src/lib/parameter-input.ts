import { z } from 'zod'

import type { Parameter } from '#/lib/parameter'
import { scalarParameterValueSchema } from '#/lib/parameter'

export type ScalarParameterDraft = Partial<Record<string, string>>

/** A scalar parameter value the declared value type already accepted. */
export type ScalarParameterValue = string | number | boolean

type ScalarValueType = Extract<Parameter['type'], { kind: 'scalar' }>['valueType']

/** The declared default decoded by the scalar schema its value type owns. */
function declaredScalarDefault(
  parameter: Parameter,
): ScalarParameterValue | undefined {
  if (parameter.type.kind !== 'scalar') return undefined

  if (parameter.defaultValue === undefined) return undefined

  const decoded = scalarParameterValueSchema(
    parameter.type.valueType,
  ).safeParse(parameter.defaultValue)

  return decoded.success ? decoded.data : undefined
}

/** A typed draft's text turned into the representation its value type stores. */
function coerceDraftText(
  valueType: ScalarValueType,
  text: string,
): ScalarParameterValue {
  if (valueType === 'integer' || valueType === 'decimal') return Number(text)

  if (valueType === 'boolean') {
    const normalised = text.toLowerCase()

    if (normalised === 'true') return true

    if (normalised === 'false') return false
  }

  return text
}

/** Display text for a scalar value: the declared default is shown as typed. */
function scalarValueText(value: ScalarParameterValue): string {
  return String(value)
}

export function parseScalarParameterValue(
  parameter: Parameter,
  rawValue: string | undefined,
): ScalarParameterValue | undefined {
  if (parameter.type.kind !== 'scalar')
    throw new Error('Only scalar parameters can be parsed here.')
  const trimmed = rawValue?.trim() ?? ''
  const hasInput = trimmed.length > 0

  const candidate = hasInput
    ? coerceDraftText(parameter.type.valueType, trimmed)
    : declaredScalarDefault(parameter)

  if (candidate === undefined) {
    if (hasInput)
      throw new Error(`Parameter "${parameter.label}" has an invalid value.`)

    if (parameter.required)
      throw new Error(`Parameter "${parameter.label}" is required.`)

    return undefined
  }

  const decoded = scalarParameterValueSchema(parameter.type.valueType)
    .safeParse(candidate)

  if (!decoded.success)
    throw new Error(`Parameter "${parameter.label}" has an invalid value.`)

  const parsed = decoded.data
  const numeric = z.number().safeParse(parsed)

  if (numeric.success) {
    if (
      parameter.constraints.min !== undefined &&
      numeric.data < parameter.constraints.min
    ) {
      throw new Error(
        `Parameter "${parameter.label}" is below the minimum value.`,
      )
    }

    if (
      parameter.constraints.max !== undefined &&
      numeric.data > parameter.constraints.max
    ) {
      throw new Error(
        `Parameter "${parameter.label}" exceeds the maximum value.`,
      )
    }
  }

  const text = z.string().safeParse(parsed)

  if (text.success) {
    if (
      parameter.constraints.minLength !== undefined &&
      text.data.length < parameter.constraints.minLength
    ) {
      throw new Error(`Parameter "${parameter.label}" is too short.`)
    }

    if (
      parameter.constraints.maxLength !== undefined &&
      text.data.length > parameter.constraints.maxLength
    ) {
      throw new Error(`Parameter "${parameter.label}" is too long.`)
    }

    if (
      parameter.constraints.pattern !== undefined &&
      !new RegExp(parameter.constraints.pattern).test(text.data)
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
export function defaultParameterDrafts(parameters: Parameter[]) {
  const drafts: ScalarParameterDraft = {}

  for (const parameter of parameters) {
    const declared = declaredScalarDefault(parameter)

    if (declared === undefined) continue

    drafts[parameter.id] = scalarValueText(declared)
  }

  return drafts
}

/** Display text for a scalar parameter's declared default, if any. */
export function scalarDefaultText(parameter: Parameter): string | null {
  const declared = declaredScalarDefault(parameter)

  return declared === undefined ? null : scalarValueText(declared)
}

export type ParameterInputWire =
  | { parameterId: string; kind: 'scalar'; value: ScalarParameterValue }
  | { parameterId: string; kind: 'record'; recordId: string }
  | { parameterId: string; kind: 'dataset'; datasetId: string }
  | { parameterId: string; kind: 'dataset-version'; datasetVersionId: string }

export function buildParameterInputs(
  parameters: Parameter[],
  drafts: ScalarParameterDraft,
): ParameterInputWire[] {
  const inputs: ParameterInputWire[] = []

  for (const parameter of parameters) {
    const raw = drafts[parameter.id]

    if (parameter.type.kind === 'scalar') {
      const parsed = parseScalarParameterValue(parameter, raw)

      if (parsed !== undefined)
        inputs.push({ parameterId: parameter.id, kind: 'scalar', value: parsed })

      continue
    }

    const value = (raw ?? '').trim()

    if (!value) {
      if (parameter.required)
        throw new Error(`Parameter "${parameter.label}" is required.`)

      continue
    }

    if (parameter.type.kind === 'record') {
      inputs.push({ parameterId: parameter.id, kind: 'record', recordId: value })

      continue
    }

    if (parameter.type.kind === 'dataset') {
      inputs.push({
        parameterId: parameter.id,
        kind: 'dataset',
        datasetId: value,
      })

      continue
    }

    inputs.push({
      parameterId: parameter.id,
      kind: 'dataset-version',
      datasetVersionId: value,
    })
  }

  return inputs
}
