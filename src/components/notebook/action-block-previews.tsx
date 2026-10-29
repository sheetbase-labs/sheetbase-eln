/**
 * R5-NOTE-02 — read-only renderers for the sign-and-attach blocks.
 *
 * Kept beside the block editor rather than inside block-preview.tsx so the
 * preview switch only gains two cases; the semantics (what a state means) live
 * in src/lib/notebook-action-blocks.ts and are not re-derived here.
 */
import { t } from '#/copy'
import { Icon } from '#/components/v3/icons'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { cn } from '#/lib/utils'
import {
  CORRECTIVE_ACTION_STATUS_LABEL,
  correctiveActionOwner,
  correctiveActionsSummary,
  isCorrectiveActionsPayload,
  isSignatureRequestPayload,
  SIGNATURE_REQUEST_STATE_LABEL,
  signatureRequestExplanation,
  signatureRequestState,
} from '#/lib/notebook-action-blocks'
import type {
  ActionBlockContext,
  CorrectiveActionStatus,
  SignatureRequestState,
} from '#/lib/notebook-action-blocks'
import { SIGNATURE_MEANING_LABEL } from '#/lib/signatures'

const SIGNATURE_REQUEST_TONE: Record<SignatureRequestState, Tone> = {
  unassigned: 'warn',
  awaiting: 'none',
  requested: 'none',
  signed: 'ok',
  changed: 'warn',
  superseded: 'warn',
}

const CORRECTIVE_STATUS_TONE: Record<CorrectiveActionStatus, Tone> = {
  open: 'none',
  'in-progress': 'progress',
  done: 'ok',
  void: 'stored',
}

/** Honest placeholder for a payload that does not match the block's schema. */
function InvalidPayload({ type }: { type: string }) {
  return (
    <p
      className="m-0 text-sm text-warning-text"
      data-testid={`${type}-invalid`}
    >
      {t('notebook.actionBlockPreviews.newerVersion')}
    </p>
  )
}

export function SignatureRequestPreview({
  payload,
  context,
}: {
  payload: unknown
  context?: ActionBlockContext
}) {
  if (!isSignatureRequestPayload(payload))
    return <InvalidPayload type="signature_request" />
  const state = signatureRequestState(payload, context)
  const explanation = signatureRequestExplanation(state, context)
  const signerLabel =
    payload.requestedUserName?.trim() ||
    (payload.requestedUserId ? payload.requestedUserId.slice(0, 8) : null)
  return (
    <div
      data-testid="signature-request-block"
      data-state={state}
      className="flex max-w-[680px] flex-wrap items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-body"
    >
      <Icon name="lock" size={14} className="text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1 max-md:basis-[calc(100%-30px)]">
        <b className="font-medium">
          {signerLabel ?? t('notebook.actionBlockPreviews.noSignerChosen')}
        </b>{' '}
        <span className="text-fg-muted">
          {t('notebook.actionBlockPreviews.meaningSignatureMeaningLabel', {
            SIGNATURE_MEANING_LABEL: SIGNATURE_MEANING_LABEL[payload.meaning],
          })}
        </span>
        {payload.note ? (
          <span className="block text-label text-fg-muted">{payload.note}</span>
        ) : null}
        {explanation ? (
          <span className="block text-label text-warning-text">
            {explanation}
          </span>
        ) : null}
      </span>
      <Status
        tone={SIGNATURE_REQUEST_TONE[state]}
        className="text-label max-md:ml-[26px]"
      >
        {SIGNATURE_REQUEST_STATE_LABEL[state]}
      </Status>
    </div>
  )
}

export function CorrectiveActionsPreview({
  payload,
}: {
  payload: unknown
  context?: ActionBlockContext
}) {
  if (!isCorrectiveActionsPayload(payload))
    return <InvalidPayload type="corrective_actions" />
  if (payload.items.length === 0) {
    return (
      <p
        className="m-0 max-w-[680px] rounded-md border border-dashed border-border-strong px-3 py-3 text-body text-fg-muted"
        data-testid="corrective-actions-empty"
      >
        {t('notebook.actionBlockPreviews.noCorrectiveActionsYet')}
      </p>
    )
  }
  const summary = correctiveActionsSummary(payload)
  const rows = payload.items
  return (
    <div
      data-testid="corrective-actions-block"
      data-open-actions={summary.open}
    >
      <TableBox className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="first:pl-3">
                {t('notebook.actionBlockPreviews.id')}
              </TableHead>
              <TableHead>{t('notebook.actionBlockPreviews.action')}</TableHead>
              <TableHead>{t('notebook.actionBlockPreviews.owner')}</TableHead>
              <TableHead>{t('notebook.actionBlockPreviews.due')}</TableHead>
              <TableHead>{t('notebook.actionBlockPreviews.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => {
              const owner = correctiveActionOwner(item)
              return (
                <TableRow key={item.id} data-action-id={item.id}>
                  <TableCell className="mono first:pl-3">{item.id}</TableCell>
                  <TableCell className="h-auto whitespace-normal py-1.5 leading-[18px]">
                    {item.action}
                  </TableCell>
                  <TableCell
                    className={cn(owner.missing && 'text-warning-text')}
                  >
                    {owner.label}
                  </TableCell>
                  <TableCell>{item.due ?? '—'}</TableCell>
                  <TableCell>
                    <Status tone={CORRECTIVE_STATUS_TONE[item.status]}>
                      {CORRECTIVE_ACTION_STATUS_LABEL[item.status]}
                    </Status>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableBox>
      <ul className="-mx-4 m-0 list-none border-y border-border-subtle p-0 md:hidden">
        {rows.map((item) => {
          const owner = correctiveActionOwner(item)
          return (
            <li
              key={item.id}
              data-action-id={item.id}
              className="flex flex-col gap-0.5 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
            >
              <span className="text-body">
                <span className="mono text-fg-muted">{item.id}</span>{' '}
                {item.action}
              </span>
              <span className="flex flex-wrap gap-x-2.5 text-label text-fg-muted">
                <Status
                  tone={CORRECTIVE_STATUS_TONE[item.status]}
                  className="text-fg"
                >
                  {CORRECTIVE_ACTION_STATUS_LABEL[item.status]}
                </Status>
                <span className={cn(owner.missing && 'text-warning-text')}>
                  {owner.label}
                </span>
                <span>
                  {t('notebook.actionBlockPreviews.dueDue', {
                    due: item.due ?? '—',
                  })}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="m-0 mt-1.5 flex flex-wrap gap-x-3 text-label text-fg-muted">
        <span>{summary.open} open</span>
        <span>
          {t('notebook.actionBlockPreviews.inprogressInProgress', {
            inProgress: summary.inProgress,
          })}
        </span>
        <span>{summary.done} done</span>
        {summary.unowned > 0 ? (
          <span className="text-warning-text">
            {t('notebook.actionBlockPreviews.unownedWithoutAnOwner', {
              unowned: summary.unowned,
            })}
          </span>
        ) : null}
      </p>
    </div>
  )
}
