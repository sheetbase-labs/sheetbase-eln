import { t } from '#/copy'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
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
  text: t('notebook.sheetPromote.text'),
  integer: t('notebook.sheetPromote.numberWhole'),
  decimal: t('notebook.sheetPromote.number'),
  boolean: t('notebook.sheetPromote.yesNo'),
  date: t('notebook.sheetPromote.date'),
  timestamp: t('notebook.sheetPromote.dateAndTime'),
  category: t('notebook.sheetPromote.choice'),
  reference: t('notebook.sheetPromote.reference'),
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
  triggerLabel = t('notebook.sheetPromote.promoteColumn'),
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
      setError(t('notebook.sheetPromote.chooseTheDatasetSchema'))
      return
    }
    if (!reason.trim()) {
      setError(t('notebook.sheetPromote.giveAReasonFor'))
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
          title={t('notebook.sheetPromote.title', { label: field.label })}
          description={t('notebook.sheetPromote.description')}
        />
        <DialogBody>
          <Field
            label={t('notebook.sheetPromote.label')}
            required
          >
            <PickerSelect
              noun="dataset schema"
              value={definitionId}
              onChange={(id) => setDefinitionId(id)}
              disabled={definitions.isPending || definitions.isError}
              placeholder={
                definitions.isPending
                  ? t('notebook.sheetPromote.loadingSchemas')
                  : t('notebook.sheetPromote.chooseADatasetSchema')
              }
              options={(definitions.data ?? []).map((definition) => ({
                id: definition.id,
                label: definition.name,
              }))}
            />
          </Field>
          {definitions.isError ? (
            <Notice
              tone="bad"
              title={t('notebook.sheetPromote.couldNotLoadDatasetTitle')}
              action={
                <Button onClick={() => void definitions.refetch()}>
                  {t('common.actions.tryAgain')}
                </Button>
              }
            >
              {t('notebook.sheetPromote.checkYourWorkspaceConnection')}
            </Notice>
          ) : definitions.isSuccess && !definitions.data.length ? (
            <Notice
              title={t('notebook.sheetPromote.noDatasetSchemaDefinitionsTitle')}
            >
              {t('notebook.sheetPromote.askAStewardTo')}
            </Notice>
          ) : null}
          <table className="w-full border-collapse text-label">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  {t('notebook.sheetPromote.localColumn')}
                </th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  {t('notebook.sheetPromote.newField')}
                </th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                  {t('notebook.sheetPromote.type')}
                </th>
                <th className="border-b border-border-subtle py-1.5 font-medium">
                  {t('notebook.sheetPromote.unit')}
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
          <Field
            label={t('notebook.sheetPromote.reasonLabel')}
            required
            hint={t('notebook.sheetPromote.hint')}
          >
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('notebook.sheetPromote.placeholder')}
            />
          </Field>
          <Notice
            tone="info"
            title={t('notebook.sheetPromote.whatHappensNextTitle')}
          >
            {t('notebook.sheetPromote.aDraftSchemaVersion')}
          </Notice>
          {error ? (
            <p role="alert" className="m-0 text-label text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={
              busy ||
              definitions.isPending ||
              definitions.isError ||
              !definitions.data.length
            }
            onClick={submit}
          >
            {busy
              ? t('notebook.sheetPromote.requesting')
              : t('notebook.sheetPromote.requestPromotion')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
