import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Field } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { createDataClient } from '#/lib/data-client'
import {
  fetchHandoverPreview,
  handOverWork,
  handoverKeys,
  sumCounts,
} from '#/lib/handover'
import type { HandoverItem, HandoverResult } from '#/lib/handover'
import { describeAdminError } from '#/lib/workspace-admin'
import { t } from '#/copy'

const dataClient = createDataClient()

/**
 * Hand a person's open work to a colleague: pick who takes over, tick what
 * moves, and the database reports what moved and what had to stay. Used by a
 * lead for someone who is leaving and by a person for their own work.
 */
export function HandoverDialog({
  workspaceId,
  userId,
  name,
  self = false,
  candidates,
  onClose,
}: {
  workspaceId: string
  userId: string
  name: string
  self?: boolean
  /** Active members who can do work, other than the person handing over. */
  candidates: { id: string; label: string }[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [recipient, setRecipient] = useState('')
  const [result, setResult] = useState<HandoverResult | null>(null)
  const bulk = useBulkSelection()

  const preview = useQuery({
    queryKey: handoverKeys.preview(workspaceId, userId),
    queryFn: () => fetchHandoverPreview(dataClient, { workspaceId, userId }),
  })

  // Everything open starts ticked: handing over is usually all of it.
  const ticked = useRef(false)
  useEffect(() => {
    if (!preview.data || ticked.current) return
    ticked.current = true
    bulk.replace(preview.data.map((item) => item.key))
  }, [preview.data, bulk])

  const send = useMutation({
    mutationFn: () =>
      handOverWork(dataClient, {
        workspaceId,
        fromUserId: userId,
        toUserId: recipient,
        selection: [...bulk.ids],
      }),
    onSuccess: (outcome) => {
      setResult(outcome)
      void queryClient.invalidateQueries({
        queryKey: handoverKeys.preview(workspaceId, userId),
      })
      // Records, tasks and reviews changed hands: lists and the Inbox reread.
      void queryClient.invalidateQueries()
    },
  })

  const recipientName =
    candidates.find((candidate) => candidate.id === recipient)?.label ?? ''

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={t('people.handover.title', { name })}
          description={
            self
              ? t('people.handover.descriptionSelf')
              : t('people.handover.description', { name })
          }
        />
        <DialogBody>
          {result ? (
            <HandoverReceipt result={result} recipientName={recipientName} />
          ) : (
            <>
              <Field label={t('people.handover.recipient')}>
                <SearchableSelect
                  noun="member"
                  value={recipient}
                  onValueChange={(value) => setRecipient(value)}
                >
                  <option value="">
                    {t('people.handover.recipientPlaceholder')}
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </SearchableSelect>
              </Field>
              <HandoverPreview
                items={preview.data ?? []}
                name={name}
                failed={preview.isError}
                error={preview.error}
                pending={preview.isPending}
                bulk={bulk}
              />
              {send.isError ? (
                <Notice tone="bad">{describeAdminError(send.error)}</Notice>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {result ? (
            <DialogClose render={<Button variant="primary" />}>
              {t('people.handover.done')}
            </DialogClose>
          ) : (
            <>
              <DialogClose render={<Button />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={!recipient || bulk.count === 0 || send.isPending}
                onClick={() => send.mutate()}
              >
                {send.isPending
                  ? t('people.handover.submitting')
                  : t('people.handover.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HandoverPreview({
  items,
  name,
  failed,
  error,
  pending,
  bulk,
}: {
  items: HandoverItem[]
  name: string
  failed: boolean
  error: Error | null
  pending: boolean
  bulk: ReturnType<typeof useBulkSelection>
}) {
  const columns: RegistryColumn<HandoverItem>[] = [
    {
      id: 'work',
      header: t('people.handover.workColumn'),
      cell: ({ row }) => row.original.label,
    },
    {
      id: 'open',
      header: t('people.handover.openColumn'),
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) => row.original.count,
    },
  ]

  if (failed) return <Notice tone="bad">{describeAdminError(error)}</Notice>

  if (pending) return <Muted>{t('people.handover.loading')}</Muted>

  if (items.length === 0)
    return <Muted>{t('people.handover.noneBody', { name })}</Muted>

  return (
    <TableBox>
      <RegistryGrid
        label={t('people.handover.tableLabel')}
        rows={items}
        columns={columns}
        getRowId={(item) => item.key}
        rowLabel={(item) => item.label}
        selectable={false}
        sortable={false}
        bulk={bulk}
      />
    </TableBox>
  )
}

function HandoverReceipt({
  result,
  recipientName,
}: {
  result: HandoverResult
  recipientName: string
}) {
  const moved = sumCounts(result.moved)
  const kept = sumCounts(result.kept)

  return (
    <>
      <Notice tone="info" icon="check">
        {t('people.handover.handedOver', { count: moved, name: recipientName })}
      </Notice>
      {kept > 0 ? (
        <Notice tone="warn">
          {t('people.handover.keptNote', { count: kept, name: recipientName })}
        </Notice>
      ) : null}
    </>
  )
}

/**
 * A line for the suspend and remove prompts: the person still has open work,
 * with a way to hand it over before they go. Says nothing when nothing is open.
 */
export function OpenWorkNotice({
  workspaceId,
  userId,
  name,
  onHandOver,
}: {
  workspaceId: string
  userId: string
  name: string
  onHandOver: () => void
}) {
  const preview = useQuery({
    queryKey: handoverKeys.preview(workspaceId, userId),
    queryFn: () => fetchHandoverPreview(dataClient, { workspaceId, userId }),
  })

  const total = (preview.data ?? []).reduce((sum, item) => sum + item.count, 0)

  if (total === 0) return null

  return (
    <Notice
      tone="warn"
      action={
        <Button size="sm" onClick={onHandOver}>
          {t('people.handover.handOverFirst')}
        </Button>
      }
    >
      {t('people.handover.stillHasWork', { count: total, name })}
    </Notice>
  )
}
