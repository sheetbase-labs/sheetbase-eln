/**
 * A form field whose input is a plugin's own screen (a field type's `input`):
 * a structure drawer for a molecule field, a sequence editor for a DNA field.
 *
 * The screen is told the field and its current value and hands back a new value
 * with `sheetbase.setValue(…)`. What it hands back is checked exactly as a
 * typed value would be: by the field type's rules in the form, and by the
 * database when the record is saved.
 */
import * as React from 'react'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { PluginFrame } from './plugin-frame'
import { t } from '#/copy'

export interface PluginFieldInputSource {
  extensionKey: string
  pluginName: string
  /** The field type's id. */
  itemId: string
  title: string
  operations: Record<string, 'read' | 'write'>
}

export function PluginFieldInput({
  source,
  definition,
  value,
  onChange,
}: {
  source: PluginFieldInputSource
  definition: ModelFieldDefinition
  value: string | boolean
  onChange: (value: string) => void
}) {
  const handle = React.useCallback(
    (name: string, payload: unknown) => {
      if (name === 'value' && (typeof payload === 'string' || payload === null))
        onChange(payload ?? '')
    },
    [onChange],
  )

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-fg-muted">
        {definition.label}
        {definition.nullable ? '' : ' *'}
      </span>
      <PluginFrame
        extensionKey={source.extensionKey}
        pluginName={source.pluginName}
        point="field-types"
        itemId={source.itemId}
        title={t('plugins.hooks.inputFor', {
          label: definition.label,
          plugin: source.pluginName,
        })}
        context={{
          value: typeof value === 'string' ? value : '',
          field: {
            name: definition.fieldName,
            label: definition.label,
            required: !definition.nullable,
          },
        }}
        operations={source.operations}
        onEmit={handle}
        className="rounded-md border border-border"
      />
    </div>
  )
}
