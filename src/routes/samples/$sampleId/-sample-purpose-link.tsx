import { Link } from '@tanstack/react-router'

import type { RecordWire } from '#/lib/notebook-data'

/** A link to the experiment or sample a value was produced in. */
export function PurposeLink({
  recordId,
  purposes,
  fallback = '—',
}: {
  recordId: string | null | undefined
  purposes: Map<string, RecordWire> | undefined
  fallback?: string
}) {
  const record = recordId ? purposes?.get(recordId) : undefined

  if (!record) return <>{fallback}</>

  if (record.kind === 'sample') {
    return (
      <Link
        to="/samples/$sampleId"
        params={{ sampleId: record.id }}
        className="mono text-link"
      >
        {record.identifier}
      </Link>
    )
  }

  return (
    <Link
      to="/experiments/$expId"
      params={{ expId: record.id }}
      className="mono text-link"
    >
      {record.identifier}
    </Link>
  )
}
