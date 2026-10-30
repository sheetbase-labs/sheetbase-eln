import { useQuery } from '@tanstack/react-query'

import { Icon } from '#/components/icons'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import {
  auditVerificationKeys,
  fetchAuditVerificationStatus,
} from '#/lib/audit-verification-status'
import { t } from '#/copy'

const dataClient = createDataClient()

/**
 * An information icon whose tooltip holds the quiet notes under a signed
 * record, sitting next to the section heading (it renders as the heading row's
 * siblings): what the signatures bind to (`note`) and when the audit trail and
 * signatures were last found intact. A failed check is not tucked away: it
 * stays on the page as a warning. Says nothing about the check while the
 * answer loads, and never claims a check that hasn't run.
 */
export function AuditCheckLine({ note }: { note?: string }) {
  const status = useQuery({
    queryKey: auditVerificationKeys.status,
    queryFn: () => fetchAuditVerificationStatus(dataClient),
    staleTime: 60_000,
  })
  const checked = status.isPending || status.isError ? undefined : status.data
  const settled = !status.isPending && !status.isError
  const time = checked ? formatDate(checked.checkedAt, { time: true }) : ''
  const failed = Boolean(checked && !checked.ok)
  const checkText = !settled
    ? null
    : !checked
      ? t('projects.signatures.checkNever')
      : checked.ok
        ? t('projects.signatures.checkVerified', { time })
        : null
  const tip = [note, checkText].filter(Boolean)
  return (
    <>
      {failed ? (
        <p
          role="alert"
          className="order-last m-0 basis-full text-label text-danger-text"
        >
          {t('projects.signatures.checkFailed', { time })}
        </p>
      ) : null}
      {tip.length > 0 ? (
        <Tooltip
          content={
            <span className="block max-w-[28rem] space-y-1">
              {tip.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          }
        >
          <button
            type="button"
            aria-label={t('projects.signatures.aboutAriaLabel')}
            className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          >
            <Icon name="info" size={14} />
          </button>
        </Tooltip>
      ) : null}
    </>
  )
}
