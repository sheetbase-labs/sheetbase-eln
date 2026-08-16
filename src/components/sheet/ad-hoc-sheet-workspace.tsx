/**
 * Local grid for Instances that currently have no source Definition.
 * This is the current editor, not a lifecycle lock: the same Instance may
 * later add Dataset/Record bindings and compose, or be extracted as a
 * Definition. Field promotion is a separate explicit path, not required.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button, Input } from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  createAdHocTextField,
  mutateSheetLocalState,
} from '#/lib/sheet-local-data'
import type { LocalFieldChange } from '#/lib/sheet-local-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import { sheetInstanceDataClient } from '#/lib/sheet-instance-data'

function activeFields(instance: SheetInstance) {
  return instance.state.localFields.filter(
    (field) => field.lifecycle === 'active',
  )
}

export function AdHocSheetWorkspace({
  instance,
  readOnly = false,
}: {
  instance: SheetInstance
  readOnly?: boolean
}) {
  const queryClient = useQueryClient()
  const [columnLabel, setColumnLabel] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const fields = activeFields(instance)
  const rowKeys = useMemo(
    () => Object.keys(instance.state.localValues),
    [instance.state.localValues],
  )
  const canWrite = !readOnly && instance.lifecycle === 'active'

  const mutate = useMutation({
    mutationFn: (input: Parameters<typeof mutateSheetLocalState>[0]) =>
      mutateSheetLocalState(input, sheetInstanceDataClient),
    onSuccess: (next) => {
      queryClient.setQueryData(['sheet-instance', instance.id], next)
      setDrafts({})
    },
  })

  const errorMessage =
    mutate.error instanceof DataClientError
      ? mutate.error.message
      : mutate.error instanceof Error
        ? mutate.error.message
        : null

  async function addColumn() {
    const field = createAdHocTextField(
      columnLabel,
      fields.map((item) => item.key),
    )
    await mutate.mutateAsync({
      instanceId: instance.id,
      expectedRevision: instance.revision,
      retryToken: crypto.randomUUID(),
      fieldChanges: [{ operation: 'add', field }],
    })
    setColumnLabel('')
  }

  async function addRow() {
    const fieldChanges: LocalFieldChange[] = []
    const existing = fields.length > 0 ? fields[0] : null
    const field =
      existing ??
      createAdHocTextField(
        columnLabel,
        fields.map((item) => item.key),
      )
    if (!existing) {
      fieldChanges.push({ operation: 'add', field })
    }
    const rowKey = crypto.randomUUID()
    await mutate.mutateAsync({
      instanceId: instance.id,
      expectedRevision: instance.revision,
      retryToken: crypto.randomUUID(),
      fieldChanges,
      rows: [{ kind: 'local', rowKey }],
      cells: [{ rowKey, fieldId: field.fieldId, value: null }],
    })
    setColumnLabel('')
  }

  async function saveCell(rowKey: string, fieldId: string, value: string) {
    const current = instance.state.localValues[rowKey][fieldId]
    const next = value === '' ? null : value
    if ((current ?? null) === next) return
    await mutate.mutateAsync({
      instanceId: instance.id,
      expectedRevision: instance.revision,
      retryToken: crypto.randomUUID(),
      rows: [{ kind: 'local', rowKey }],
      cells: [{ rowKey, fieldId, value: next }],
    })
  }

  return (
    <div className="space-y-3 p-1">
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">New column</span>
            <Input
              value={columnLabel}
              onChange={(event) => setColumnLabel(event.target.value)}
              placeholder="Column name"
              className="h-8 w-44"
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={mutate.isPending}
            onClick={() => void addColumn()}
          >
            Add column
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={mutate.isPending}
            onClick={() => void addRow()}
          >
            Add row
          </Button>
        </div>
      ) : null}
      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          This Sheet has no columns yet. Add a column to start entering data.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" aria-label="Sheet">
            <thead>
              <tr className="border-b bg-muted/40">
                {fields.map((field) => (
                  <th key={field.fieldId} className="px-3 py-2 text-left">
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowKeys.length === 0 ? (
                <tr>
                  <td
                    colSpan={fields.length}
                    className="px-3 py-3 text-muted-foreground"
                  >
                    No rows yet.
                  </td>
                </tr>
              ) : (
                rowKeys.map((rowKey) => (
                  <tr key={rowKey} className="border-b last:border-0">
                    {fields.map((field) => {
                      const draftKey = `${rowKey}:${field.fieldId}`
                      const stored =
                        instance.state.localValues[rowKey][field.fieldId]
                      const display =
                        drafts[draftKey] ??
                        (stored == null ? '' : String(stored))
                      return (
                        <td key={field.fieldId} className="px-2 py-1">
                          <input
                            aria-label={`${field.label} value`}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={display}
                            disabled={!canWrite || mutate.isPending}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [draftKey]: event.target.value,
                              }))
                            }
                            onBlur={() =>
                              void saveCell(rowKey, field.fieldId, display)
                            }
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
