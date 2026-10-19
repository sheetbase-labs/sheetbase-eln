import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { Field } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import {
  DEVIATION_REASON_MAX,
  fetchStepDeviations,
  isPinnedProtocolStep,
  normaliseDeviationReason,
  recordDeviationReason,
} from '#/lib/protocol-deviations'
import { useUserNames } from '#/lib/user-names'
import type { SaveResult } from './use-autosave'

const deviationsKey = (blockId: string) =>
  ['ui-port', 'step-deviations', blockId] as const

type Mode = 'closed' | 'new' | 'reason'

/**
 * A step copied from a protocol is meant to be run as written. When it was done
 * differently, this records what was done instead and why, against the step:
 * the new text is saved (the database notes the deviation from the frozen
 * protocol text) and the reason is attached to that deviation, so History and
 * review read what changed and the person's explanation together.
 */
export function StepDeviation({
  block,
  save,
  readOnly,
}: {
  block: Pick<NotebookBlock, 'id' | 'payload'>
  save: (
    payload: Record<string, unknown>,
  ) => Promise<SaveResult<Record<string, unknown>>>
  readOnly?: boolean
}) {
  const pinned = isPinnedProtocolStep(block.payload)
  const queryClient = useQueryClient()
  const [mode, setMode] = React.useState<Mode>('closed')
  const currentText =
    typeof block.payload.text === 'string' ? block.payload.text : ''
  const [text, setText] = React.useState(currentText)
  const [reason, setReason] = React.useState('')

  const deviations = useQuery({
    queryKey: deviationsKey(block.id),
    queryFn: () => fetchStepDeviations(notebookDataClient, block.id),
    enabled: pinned,
  })
  const latest = deviations.data?.at(0)
  const names = useUserNames(
    latest?.reason_by_user_id ? [latest.reason_by_user_id] : [],
  )

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: deviationsKey(block.id) })
  const fail = (title: string) => (error: unknown) =>
    toast.error(
      `${title} ${error instanceof Error ? error.message : 'Please try again.'}`,
    )

  const addReason = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      recordDeviationReason(notebookDataClient, input.id, input.reason),
    onSuccess: async () => {
      await refresh()
      setMode('closed')
      setReason('')
      toast('Reason recorded against the step')
    },
    onError: fail('Could not record the reason.'),
  })

  const deviate = useMutation({
    mutationFn: async (input: { text: string; reason: string }) => {
      const result = await save({ ...block.payload, text: input.text })
      if (!result.ok) {
        throw new Error(
          result.message ?? 'The step could not be saved. Try again.',
        )
      }
      const rows = await fetchStepDeviations(notebookDataClient, block.id)
      const created = rows.at(0)
      if (!created || created.recorded_text !== input.text) {
        throw new Error('The deviation was not recorded.')
      }
      await recordDeviationReason(notebookDataClient, created.id, input.reason)
    },
    onSuccess: async () => {
      await refresh()
      setMode('closed')
      setReason('')
      toast('Deviation recorded', {
        description: 'It appears in the experiment’s History with its reason.',
      })
    },
    onError: fail('Could not record the deviation.'),
  })

  if (!pinned) return null
  const cleanReason = normaliseDeviationReason(reason)
  const busy = addReason.isPending || deviate.isPending

  if (mode === 'new') {
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <Field label="What was done instead" required>
          <Textarea
            value={text}
            rows={2}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field label="Why" required hint="Shown in History and at review.">
          <Textarea
            value={reason}
            rows={2}
            maxLength={DEVIATION_REASON_MAX}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={
              busy || !cleanReason || !text.trim() || text === currentText
            }
            onClick={() =>
              cleanReason
                ? deviate.mutate({ text: text.trim(), reason: cleanReason })
                : undefined
            }
          >
            {busy ? 'Recording…' : 'Record deviation'}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => setMode('closed')}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (latest && !latest.reason) {
    return (
      <Notice
        tone="warn"
        title="This step differs from the protocol and has no reason yet."
      >
        <div className="mt-2 space-y-2">
          <p className="m-0 text-caption text-fg-muted">
            Protocol: {latest.frozen_text}
          </p>
          {readOnly ? null : (
            <>
              <Field label="Why was it done differently?" required>
                <Textarea
                  value={reason}
                  rows={2}
                  maxLength={DEVIATION_REASON_MAX}
                  disabled={busy}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !cleanReason}
                onClick={() =>
                  cleanReason
                    ? addReason.mutate({ id: latest.id, reason: cleanReason })
                    : undefined
                }
              >
                {busy ? 'Recording…' : 'Record the reason'}
              </Button>
            </>
          )}
        </div>
      </Notice>
    )
  }

  return (
    <div className="space-y-1.5">
      {latest?.reason ? (
        <Notice tone="info" title="Deviation from the protocol.">
          <p className="m-0 text-caption text-fg-muted">
            Protocol: {latest.frozen_text}
          </p>
          <p className="m-0">
            Why: {latest.reason}
            {latest.reason_by_user_id
              ? ` (${names.userLabel(latest.reason_by_user_id)})`
              : ''}
          </p>
        </Notice>
      ) : null}
      {readOnly ? null : (
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            setText(currentText)
            setReason('')
            setMode('new')
          }}
        >
          {latest ? 'Record another deviation' : 'Record a deviation'}
        </Button>
      )}
    </div>
  )
}
