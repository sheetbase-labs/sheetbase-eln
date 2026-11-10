/** A handler's view of one request: what was asked, and accept, decline or complete it. */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useRecordModelFields } from '#/components/models/models-data'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  decideRequest,
  messageOf,
  nextDecisions,
  requestKeys,
} from '#/lib/requests'
import type { RequestDecision, RequestRow } from '#/lib/requests'

import { requestDetails } from './requests-shared'

export function DecideRequestDialog(props: DecideRequestDialogProps) {
  // Another request is another decision: a new body starts with an empty note
  // rather than resetting this one's state after the prop changes.
  return <RequestDecision key={props.request?.id ?? ''} {...props} />
}

interface DecideRequestDialogProps {
  request: RequestRow | null
  askerName: string
  onClose: () => void
}

function RequestDecision({
  request,
  askerName,
  onClose,
}: DecideRequestDialogProps) {
  const fields = useRecordModelFields(request?.kind ?? '')

  const fieldLabels = new Map(
    (fields.data ?? []).map((f) => [f.fieldName, f.label] as const),
  )

  const queryClient = useQueryClient()
  const [note, setNote] = useState('')

  const decide = useMutation({
    mutationFn: (decision: RequestDecision) =>
      decideRequest(notebookDataClient, {
        recordId: request?.id ?? '',
        decision,
        note,
      }),
    onSuccess: (_, decision) => {
      void queryClient.invalidateQueries({ queryKey: requestKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
      toast.success(
        t('requests.decide.saved', {
          status: t(`requests.statuses.${decision}`).toLowerCase(),
        }),
      )
      onClose()
    },
    onError: (e) =>
      toast.error(messageOf(e, t('requests.decide.couldNotSave'))),
  })

  const details = request ? requestDetails(request, fieldLabels) : []

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('requests.decide.title', {
            identifier: request?.identifier ?? '',
          })}
        />
        <DialogBody>
          {request ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="m-0 font-medium">{request.title}</p>
                <p className="m-0 text-label text-fg-muted">
                  {t('requests.decide.askedBy', {
                    name: askerName,
                    date: formatDate(request.created_at),
                  })}
                </p>
              </div>
              {details.length > 0 ? (
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
                  {details.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-fg-muted">{label}</dt>
                      <dd className="m-0">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {request.note ? (
                <p className="m-0 text-body">
                  <span className="text-fg-muted">
                    {t('requests.decide.theirNote')}:{' '}
                  </span>
                  {request.note}
                </p>
              ) : null}
              <Field
                label={t('requests.decide.note', { name: askerName })}
                hint={t('requests.decide.noteHint')}
              >
                <Input
                  value={note}
                  maxLength={4000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {request ? (
            <Button
              variant="quiet"
              nativeButton={false}
              render={
                <Link
                  to="/models/$modelId/records/$recordId"
                  params={{ modelId: request.kind, recordId: request.id }}
                />
              }
            >
              {t('requests.decide.open')}
            </Button>
          ) : null}
          <span className="flex-1" />
          <DialogClose render={<Button variant="quiet" />}>
            {t('requests.decide.close')}
          </DialogClose>
          {request
            ? nextDecisions(request.status).map((decision) => (
                <Button
                  key={decision}
                  variant={decision === 'accepted' ? 'primary' : 'secondary'}
                  disabled={decide.isPending}
                  onClick={() => decide.mutate(decision)}
                >
                  {t(`requests.decisions.${decision}`)}
                </Button>
              ))
            : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
