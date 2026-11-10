import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { t } from '#/copy'
import { createDataClient } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { listCanonicalDatasetSchemaDefinitions } from '#/lib/dataset-schema-definition-rpc'
import {
  describeColumnPromotionError,
  requestColumnPromotion,
} from '#/lib/schema-evolution'
import type { ColumnPromotionRequestResult } from '#/lib/schema-evolution'
import type { SheetInstanceState } from '#/lib/sheet-instance'

const sheetPromoteDataClient = createDataClient()

type LocalField = SheetInstanceState['localFields'][number]

export type SheetPromoteLocalField = Pick<
  LocalField,
  'fieldId' | 'key' | 'label' | 'logicalType'
> & {
  quantity?: Partial<
    Pick<
      NonNullable<LocalField['quantity']>,
      'storageUnit' | 'preferredDisplayUnit'
    >
  > | null
}

export interface SheetPromoteProps {
  instanceId: string
  field: SheetPromoteLocalField
  client?: DataClient
  expectedRevision?: number | null
  triggerLabel?: string
  /** Omit for internal visibility, or control it from the column menu. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: boolean
  onSubmitted?: (result: ColumnPromotionRequestResult) => void
}

export function useSheetPromote({
  instanceId,
  field,
  client = sheetPromoteDataClient,
  expectedRevision,
  open: controlledOpen,
  onOpenChange,
  onSubmitted,
}: SheetPromoteProps) {
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
      // Compatibility and draft-version refusals belong to the server.
      setError(describeColumnPromotionError(e))
    } finally {
      setBusy(false)
    }
  }

  return {
    open,
    setOpen,
    definitionId,
    setDefinitionId,
    reason,
    setReason,
    busy,
    error,
    definitions,
    submit,
  }
}
