import { z } from 'zod'
import { t } from '#/copy'
import type { PipelineParameter } from '#/lib/pipelines/config'

const parameterScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export function parameterText(parameter: PipelineParameter) {
  const value = parameterScalarSchema.safeParse(parameter.default)

  return value.success ? String(value.data) : ''
}

export function parameterValue(parameter: PipelineParameter, raw: string) {
  const text = raw.trim()

  if (text === '') return undefined

  switch (parameter.type) {
    case 'integer':
    case 'decimal':
      return Number(text)
    case 'boolean':
      return text === 'true'
    default:
      return text
  }
}

export function parameterError(
  parameter: PipelineParameter,
  raw: string,
): string | undefined {
  const text = raw.trim()

  if (text === '') return parameter.required ? 'Required.' : undefined

  if (parameter.type === 'integer' && !/^-?\d+$/.test(text))
    return t('data.runDialog.enterWholeNumber')

  if (parameter.type === 'decimal' && Number.isNaN(Number(text)))
    return t('data.runDialog.enterNumber')

  if (parameter.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text))
    return t('data.runDialog.useFormatYyyyMm')

  return undefined
}
