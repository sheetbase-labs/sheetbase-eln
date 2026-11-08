/**
 * Plugin field types on model fields: checking what a person types against the
 * type's rules, and the picker a person with permission to edit models uses to
 * give a field a plugin's type.
 */
import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { notebookDataClient } from '#/lib/notebook-data'
import { checkFieldTypeValue } from '#/lib/extensions/hooks'
import { t } from '#/copy'
import { useFieldPluginTypes } from './table-hooks'
import { usePluginPoints } from './use-plugin-points'

/** Errors by field name for values that break a plugin field type's rules. */
export function usePluginFieldTypeErrors(
  modelKey: string,
  fields: readonly ModelFieldDefinition[],
  values: Record<string, string | boolean>,
): Record<string, string> {
  const points = usePluginPoints()
  const links = useFieldPluginTypes(modelKey)
  return React.useMemo(() => {
    const errors: Record<string, string> = {}
    for (const link of links.data ?? []) {
      const field = fields.find((f) => f.fieldName === link.field_name)
      const raw = values[link.field_name]
      if (!field || typeof raw !== 'string') continue
      const type = points.fieldTypes.find(
        (item) =>
          item.extensionKey === link.plugin_key && item.id === link.type_id,
      )
      if (!type) continue
      const problem = checkFieldTypeValue(type.declaration, raw)
      if (problem) errors[link.field_name] = problem
    }
    return errors
  }, [links.data, points.fieldTypes, fields, values])
}

/** The example a plugin field type suggests for a field, by field name. */
export function usePluginFieldPlaceholders(
  modelKey: string,
): Record<string, string> {
  const points = usePluginPoints()
  const links = useFieldPluginTypes(modelKey)
  return React.useMemo(() => {
    const out: Record<string, string> = {}
    for (const link of links.data ?? []) {
      const example = points.fieldTypes.find(
        (item) =>
          item.extensionKey === link.plugin_key && item.id === link.type_id,
      )?.declaration.placeholder
      if (example) out[link.field_name] = example
    }
    return out
  }, [links.data, points.fieldTypes])
}

/**
 * Pick a plugin's type for one published field. The choice applies to the
 * field at once (it changes how values are drawn and checked, not what the
 * database stores), so it asks nothing of the model's draft.
 */
export function FieldPluginTypePicker({
  modelKey,
  fieldName,
  logicalType,
}: {
  modelKey: string
  fieldName: string
  logicalType: string
}) {
  const points = usePluginPoints()
  const links = useFieldPluginTypes(modelKey)
  const queryClient = useQueryClient()
  const current = links.data?.find((l) => l.field_name === fieldName)
  const offered = points.fieldTypes.filter(
    (item) => item.declaration.base === logicalType,
  )
  const apply = useMutation({
    mutationFn: (value: string) => {
      const [key, id] = value ? value.split('/') : [null, null]
      return notebookDataClient.rpc('set_field_plugin_type', {
        p_kind: modelKey,
        p_field_name: fieldName,
        p_plugin_key: key,
        p_type_id: id,
      })
    },
    onSuccess: (_, value) => {
      toast(
        value
          ? t('plugins.hooks.fieldTypeApplied', {
              type:
                offered.find((o) => `${o.extensionKey}/${o.id}` === value)
                  ?.declaration.title ?? value,
            })
          : t('plugins.hooks.fieldTypeCleared'),
      )
      void queryClient.invalidateQueries({
        queryKey: ['plugin-hooks', 'field-types', modelKey],
      })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
  })
  if (offered.length === 0 && !current) return null
  const value = current ? `${current.plugin_key}/${current.type_id}` : ''
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{t('plugins.hooks.fieldTypeLabel')}</span>
      <Select
        size="sm"
        value={value}
        disabled={apply.isPending}
        aria-label={t('plugins.hooks.fieldTypeLabel')}
        onChange={(event) => apply.mutate(event.target.value)}
      >
        <option value="">{t('plugins.hooks.fieldTypeNone')}</option>
        {offered.map((item) => (
          <option
            key={`${item.extensionKey}/${item.id}`}
            value={`${item.extensionKey}/${item.id}`}
          >
            {item.declaration.title} · {item.extensionName}
          </option>
        ))}
        {current &&
        !offered.some(
          (o) =>
            o.extensionKey === current.plugin_key && o.id === current.type_id,
        ) ? (
          <option
            value={value}
          >{`${current.type_id} · ${current.plugin_key}`}</option>
        ) : null}
      </Select>
    </label>
  )
}
