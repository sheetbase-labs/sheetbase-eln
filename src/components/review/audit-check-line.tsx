import { useQuery } from '@tanstack/react-query'

import { Muted } from '#/components/v3/ui/layout'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import {
  auditVerificationKeys,
  fetchAuditVerificationStatus,
} from '#/lib/audit-verification-status'
import { t } from '#/copy'

const dataClient = createDataClient()

/**
 * Says whether the audit trail and the signatures were last found intact, and
 * when. Shown under signed records so a reader doesn't have to open Settings to
 * know the signature still holds. Says nothing while the answer loads, and
 * never claims a check that hasn't run.
 */
export function AuditCheckLine() {
  const status = useQuery({
    queryKey: auditVerificationKeys.status,
    queryFn: () => fetchAuditVerificationStatus(dataClient),
    staleTime: 60_000,
  })
  if (status.isPending || status.isError) return null
  const checked = status.data
  if (!checked) return <Muted>{t('projects.signatures.checkNever')}</Muted>
  const time = formatDate(checked.checkedAt, { time: true })
  return checked.ok ? (
    <Muted>{t('projects.signatures.checkVerified', { time })}</Muted>
  ) : (
    <p role="alert" className="m-0 text-label text-danger-text">
      {t('projects.signatures.checkFailed', { time })}
    </p>
  )
}
