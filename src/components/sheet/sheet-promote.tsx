import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { listCanonicalDatasetSchemaDefinitions } from '#/lib/dataset-schema-definition-rpc'
import {
  describeColumnPromotionError,
  requestColumnPromotion,
} from '#/lib/schema-evolution'
import type { ColumnPromotionRequestResult } from '#/lib/schema-evolution'

const sheetPromoteDataClient = createDataClient()

/** The slice of a sheet's local field the dialog needs to describe it. */
export interface SheetPromoteLocalField {
  fieldId: string
  key: string
  label: string
  logicalType: string
  quantity?: {
    storageUnit?: string | null
    preferredDisplayUnit?: string | null
  } | null
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  integer: 'Number, whole',
  decimal: 'Number',
  boolean: 'Yes / no',
  date: 'Date',
  timestamp: 'Date and time',
  category: 'Choice',
  reference: 'Reference',
}

/**
 * SHEET-02.3 — the Promote local columns dialog (canvas/SheetPromote).
 *
 * A local column becomes a dataset column only through a reviewed request. The
 * dialog names the target Dataset Schema Definition, shows the field type and
 * unit that will be added, and takes a reason. It submits through
 * `request_column_promotion` — never the direct `promote_local_field` path —
 * so nothing is written to the dataset until the MDL-03 approval is granted.
 */
export function SheetPromote({
  instanceId,
  field,
  client = sheetPromoteDataClient,
  expectedRevision,
  triggerLabel = 'Promote column…',
  open: controlledOpen,
  onOpenChange,
  trigger = true,
  onSubmitted,
}: {
  instanceId: string
  field: SheetPromoteLocalField
  client?: DataClient
  expectedRevision?: number | null
  triggerLabel?: string
  /**
   * Controlled visibility. Omit to let the dialog own its open state behind
   * its own trigger (the default). The Sheet's column menu sets it so a menu
   * entry — not a button rendered next to the grid — opens the dialog.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Render the built-in trigger button. Set false when the host opens it. */
  trigger?: boolean
  onSubmitted?: (result: ColumnPromotionRequestResult) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [definitionId, setDefinitionId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const definitions = useQuery({
    queryKey: ['dataset-schema-definitions', 'promote-target'],
    enabled: open,
    queryFn: () => listCanonicalDatasetSchemaDefinitions(client),
  })

  const submit = async () => {
    if (!definitionId) {
      setError('Choose the dataset these columns should join.')
      return
    }
    if (!reason.trim()) {
      setError('Give a reason for the promotion.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await requestColumnPromotion(client, {
        instanceId,
        fieldId: field.fieldId,
        target: 'dataset_schema',
        schemaDefinitionId: definitionId,
        reason: reason.trim(),
        idempotencyKey: crypto.randomUUID(),
        expectedRevision,
      })
      onSubmitted?.(result)
      setOpen(false)
      setReason('')
      setDefinitionId('')
    } catch (e) {
      // The server owns compatibility (SB071) and draft-version rules (SB072);
      // show its refusal rather than claiming the promotion succeeded.
      setError(describeColumnPromotionError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <Button onClick={() => setOpen(true)}>{triggerLabel}</Button>
      ) : null}
      <DialogContent className="w-[min(680px,calc(100vw-32px))]">
        <DialogHeader
          title={`Promote ${field.label}`}
          description="The model change is reviewed first; nothing moves until it is approved."
        />
        <DialogBody>
          <Field label="Where to" required>
            <Select
              value={definitionId}
              onChange={(e) => setDefinitionId(e.target.value)}
            >
              <option value="">Choose a dataset…</option>
              {(definitions.data ?? []).map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </Select>
          </Field>
          <table className="w-full border-collapse text-label">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  Local column
                </th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  New field
                </th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  Type
                </th>
                <th className="border-b border-border-subtle py-1.5 font-medium">
                  Unit
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-border-subtle py-1.5 pr-2">
                  {field.label}
                </td>
                <td className="border-b border-border-subtle py-1.5 pr-2 font-mono">
                  {field.key}
                </td>
                <td className="border-b border-border-subtle py-1.5 pr-2">
                  {TYPE_LABELS[field.logicalType] ?? field.logicalType}
                </td>
                <td className="border-b border-border-subtle py-1.5">
                  {field.quantity?.preferredDisplayUnit ??
                    field.quantity?.storageUnit ??
                    '—'}
                </td>
              </tr>
            </tbody>
          </table>
          <Field label="Reason" required hint="Shown to the reviewer.">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this column belongs in the dataset"
            />
          </Field>
          <Notice tone="info" title="What happens next">
            A draft schema version is created and sent for approval. When it is
            approved, the values are saved as a new snapshot of the dataset with
            this sheet as its source, and the column stops being local.
          </Notice>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? 'Requesting…' : 'Request promotion'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
