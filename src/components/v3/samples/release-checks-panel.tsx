import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { samplePath } from '#/lib/navigation'
import { fetchSampleReleaseCheckStatus, sampleQueryKeys } from '#/lib/samples'
import type { SampleReleaseCheckStatus } from '#/lib/samples'
import { rich, t } from '#/copy'

/**
 * The release checks a quarantined sample has to pass, read live from the same
 * rule set and measurement read model the server enforces on Release. It says
 * which checks pass, which do not and why, and where to add the missing value,
 * so the person is not left to attempt a release to find out.
 */
export function ReleaseChecksSummary({
  status,
  sampleId,
  measurementCount,
}: {
  status: SampleReleaseCheckStatus
  sampleId: string
  /** How many measurements the sample has, when the caller knows. */
  measurementCount?: number
}) {
  if (status.checks.length === 0) {
    return (
      <p className="m-0 text-label text-fg-muted">
        {t('library.samples.releaseChecksPanel.noReleaseChecksApplyTo')}
      </p>
    )
  }
  const passing = status.checks.filter((check) => check.passed).length
  // Checks over no data pass by default; that is not the same as being checked.
  const unchecked = status.passed && measurementCount === 0
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="m-0 text-label">
        <Status tone={unchecked ? 'none' : status.passed ? 'ok' : 'warn'}>
          {unchecked
            ? t('library.samples.releaseChecksPanel.notCheckedYet')
            : status.passed
              ? t('library.samples.releaseChecksPanel.allChecksPass')
              : t('library.samples.releaseChecksPanel.ofChecksPass', {
                  passing,
                  checks: status.checks.length,
                })}
        </Status>
      </p>
      <ul
        aria-label={t('library.samples.releaseChecksPanel.releaseChecks')}
        className="m-0 flex list-none flex-col gap-1.5 p-0"
      >
        {status.checks.map((check) => (
          <li key={check.key} className="flex flex-col text-label">
            <span className="flex items-center gap-2">
              <Status tone={unchecked ? 'none' : check.passed ? 'ok' : 'bad'}>
                {unchecked
                  ? t('library.samples.releaseChecksPanel.notChecked')
                  : check.passed
                    ? t('library.samples.releaseChecksPanel.pass')
                    : t('library.samples.releaseChecksPanel.notMet')}
              </Status>
              <span className="min-w-0">{check.label}</span>
            </span>
            {!check.passed && check.detail ? (
              <span className="pl-1 text-fg-muted">{check.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {unchecked ? (
        <p className="m-0 text-label text-fg-muted">
          {rich(
            'library.samples.releaseChecksPanel.noMeasurementsAreRecordedSo',
            {
              link: (text) => (
                <Link
                  to="/readings/new"
                  search={{ sample: sampleId, returnTo: samplePath(sampleId) }}
                  className="text-link"
                >
                  {text}
                </Link>
              ),
            },
          )}
        </p>
      ) : status.passed ? (
        <p className="m-0 text-label text-fg-muted">
          {t('library.samples.releaseChecksPanel.thisSampleCanBeReleased')}
        </p>
      ) : (
        <p className="m-0 text-label text-fg-muted">
          {rich(
            'library.samples.releaseChecksPanel.releaseStaysBlockedUntilThe',
            {
              link: (text) => (
                <Link
                  to="/readings/new"
                  search={{ sample: sampleId, returnTo: samplePath(sampleId) }}
                  className="text-link"
                >
                  {text}
                </Link>
              ),
              link2: (text) => (
                <Link
                  to="/samples/$sampleId/measurements"
                  params={{ sampleId }}
                  className="text-link"
                >
                  {text}
                </Link>
              ),
            },
          )}
        </p>
      )}
    </div>
  )
}

export function ReleaseChecksPanel({
  sampleId,
  client = notebookDataClient,
  measurementCount,
}: {
  sampleId: string
  client?: DataClient
  measurementCount?: number
}) {
  const query = useQuery({
    queryKey: sampleQueryKeys.releaseChecks(sampleId),
    queryFn: () => fetchSampleReleaseCheckStatus(client, sampleId),
    // A reading recorded on another page should show when the person returns.
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  if (query.isPending)
    return (
      <p className="m-0 text-label text-fg-muted">
        {t('library.samples.releaseChecksPanel.checking')}
      </p>
    )
  if (query.isError)
    return (
      <p role="alert" className="m-0 text-label text-danger-text">
        {t('library.samples.releaseChecksPanel.theReleaseChecksCouldNot')}
      </p>
    )
  return (
    <ReleaseChecksSummary
      status={query.data}
      sampleId={sampleId}
      measurementCount={measurementCount}
    />
  )
}
