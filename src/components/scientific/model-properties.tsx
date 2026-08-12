import { useEffect, useState } from 'react'
import { LockKeyhole, Pencil } from 'lucide-react'

import { ModelFieldInput } from './model-field-input'
import { Button } from '#/components/ui'
import {
  displayModelFieldValue,
  modelFieldValuesFromInput,
} from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'

export interface LockedModelProperty {
  key: string
  label: string
  value: React.ReactNode
}

export function ModelProperties({
  lockedProperties,
  definitions,
  values,
  recordLocked = false,
  saving = false,
  onSave,
}: {
  lockedProperties: LockedModelProperty[]
  definitions: ModelFieldDefinition[]
  values: Record<string, unknown>
  recordLocked?: boolean
  saving?: boolean
  onSave?: (values: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [inputs, setInputs] = useState<Record<string, string | boolean>>({})

  useEffect(() => {
    setInputs(
      Object.fromEntries(
        definitions.map((definition) => {
          const value = values[definition.fieldName]
          return [
            definition.fieldName,
            typeof value === 'boolean'
              ? value
              : value == null
                ? ''
                : String(value),
          ]
        }),
      ),
    )
    setEditing(false)
  }, [definitions, values])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          System properties are locked. Workspace properties use the same record
          layout.
        </p>
        {onSave && definitions.length > 0 && !editing ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={recordLocked}
            title={recordLocked ? 'This record is locked.' : undefined}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
      </div>

      <dl className="divide-y rounded-md border">
        {lockedProperties.map((property) => (
          <div
            key={property.key}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-3 py-2 text-xs"
          >
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <LockKeyhole
                className="size-3 shrink-0"
                aria-label="Locked system property"
              />{' '}
              {property.label}
            </dt>
            <dd className="min-w-0 text-right font-medium">{property.value}</dd>
          </div>
        ))}
        {definitions.map((definition) => (
          <div
            key={definition.id}
            className="grid min-h-9 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2 text-xs"
          >
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              {recordLocked ? (
                <LockKeyhole
                  className="size-3 shrink-0"
                  aria-label="Locked workspace property"
                />
              ) : null}
              {definition.label}
              {!definition.nullable ? (
                <span aria-label="Required">*</span>
              ) : null}
            </dt>
            <dd className="min-w-0 text-right font-medium">
              {editing ? (
                <ModelFieldInput
                  definition={definition}
                  value={inputs[definition.fieldName] ?? ''}
                  onChange={(value) =>
                    setInputs((current) => ({
                      ...current,
                      [definition.fieldName]: value,
                    }))
                  }
                  showLabel={false}
                />
              ) : (
                <>
                  {displayModelFieldValue(
                    definition,
                    values[definition.fieldName],
                  )}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {editing ? (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              onSave?.(modelFieldValuesFromInput(definitions, inputs, false))
            }
          >
            Save properties
          </Button>
        </div>
      ) : null}
    </div>
  )
}
