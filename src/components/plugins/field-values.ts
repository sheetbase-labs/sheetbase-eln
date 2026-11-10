/**
 * The values a plugin's declared fields hold, apart from the form that draws
 * them: the label for each box, what the person typed turned into what the
 * plugin declared, and a returned value as a person reads it.
 */
import { z } from 'zod'

import { t } from '#/copy'
import type { ExtensionField } from '#/lib/extensions/points'

/** A plugin call's input: the object its declared fields produce. */
const pluginInputSchema = z.record(z.string(), z.unknown())

type PluginInput = z.infer<typeof pluginInputSchema>

/** `seeding_density` becomes "Seeding density" when the plugin gave no label. */
export function fieldLabel(field: ExtensionField): string {
  if (field.label) return field.label
  const spaced = field.name.replaceAll('_', ' ')

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export type FieldValues = Record<string, string>

export type ReadFieldValues =
  { ok: true; input: PluginInput } | { ok: false; missing: string[] }

export function readFieldValues(
  fields: readonly ExtensionField[],
  values: FieldValues,
): ReadFieldValues {
  const input: PluginInput = {}
  const missing: string[] = []

  for (const field of fields) {
    const raw = (values[field.name] ?? '').trim()

    if (field.type === 'boolean') {
      input[field.name] = raw === 'true'
      continue
    }

    if (raw === '') {
      if (field.required) missing.push(fieldLabel(field))
      continue
    }

    if (field.type === 'number' || field.type === 'integer') {
      const n = Number(raw)

      const ok =
        Number.isFinite(n) && (field.type === 'number' || Number.isInteger(n))

      if (!ok) {
        missing.push(fieldLabel(field))
        continue
      }

      input[field.name] = n
    } else if (field.type === 'json') {
      try {
        input[field.name] = JSON.parse(raw)
      } catch {
        missing.push(fieldLabel(field))
      }
    } else input[field.name] = raw
  }

  return missing.length ? { ok: false, missing } : { ok: true, input }
}

/** A value a plugin returned, as a person reads it. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The value is a plugin's own JSON answer, of no shape this file knows; each form it can take is read below and anything else is shown as JSON.
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  const flag = z.boolean().safeParse(value).data

  if (flag !== undefined)
    return flag ? t('calculators.plugin.yes') : t('calculators.plugin.no')
  const stored = z.number().safeParse(value).data

  if (stored !== undefined)
    return Number.isInteger(stored)
      ? String(stored)
      : String(Number(stored.toPrecision(6)))
  const text = z.string().safeParse(value).data

  if (text !== undefined) return text

  return JSON.stringify(value)
}
