import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import { samplePath } from '#/lib/navigation'
import { fetchSampleReleaseCheckStatus, sampleQueryKeys } from '#/lib/samples'
import type { SampleReleaseCheckStatus } from '#/lib/samples'

/**
 * The release checks a quarantined sample has to pass, read live from the same
 * rule set and measurement read model the server enforces on Release. It says
 * which checks pass, which do not and why, and where to add the missing value,
 * so the person is not left to attempt a release to find out.
 */
export function ReleaseChecksSummary({
  status,
  sampleId,
}: {
  status: SampleReleaseCheckStatus
  sampleId: string
}) {
  if (status.checks.length === 0) {
    return (
      <p className="m-0 text-label text-fg-muted">
        No release checks apply to this sample type.
      </p>
    )
  }
  const passing = status.checks.filter((check) => check.passed).length
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="m-0 text-label">
        <Status tone={status.passed ? 'ok' : 'warn'}>
          {status.passed
            ? 'All checks pass'
            : `${passing} of ${status.checks.length} checks pass`}
        </Status>
      </p>
      <ul
        aria-label="Release checks"
        className="m-0 flex list-none flex-col gap-1.5 p-0"
      >
        {status.checks.map((check) => (
          <li key={check.key} className="flex flex-col text-label">
            <span className="flex items-center gap-2">
              <Status tone={check.passed ? 'ok' : 'bad'}>
                {check.passed ? 'Pass' : 'Not met'}
              </Status>
              <span className="min-w-0">{check.label}</span>
            </span>
            {!check.passed && check.detail ? (
              <span className="pl-1 text-fg-muted">{check.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {status.passed ? (
        <p className="m-0 text-label text-fg-muted">
          This sample can be released.
        </p>
      ) : (
        <p className="m-0 text-label text-fg-muted">
          Release stays blocked until the checks above are met.{' '}
          <Link
            to="/readings/new"
            search={{ sample: sampleId, returnTo: samplePath(sampleId) }}
            className="text-link"
          >
            Record a reading
          </Link>{' '}
          or{' '}
          <Link
            to="/samples/$sampleId/measurements"
            params={{ sampleId }}
            className="text-link"
          >
            see the measurements
          </Link>
          .
        </p>
      )}
    </div>
  )
}

export function ReleaseChecksPanel({
  sampleId,
  client = notebookDataClient,
}: {
  sampleId: string
  client?: DataClient
}) {
  const query = useQuery({
    queryKey: sampleQueryKeys.releaseChecks(sampleId),
    queryFn: () => fetchSampleReleaseCheckStatus(client, sampleId),
    // A reading recorded on another page should show when the person returns.
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
  if (query.isPending)
    return <p className="m-0 text-label text-fg-muted">Checking…</p>
  if (query.isError)
    return (
      <p role="alert" className="m-0 text-label text-danger-text">
        The release checks could not be read. Reload to try again.
      </p>
    )
  return <ReleaseChecksSummary status={query.data} sampleId={sampleId} />
}
