import { useQuery } from '@tanstack/react-query'

import { useUserNames } from '#/lib/user-names'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { listTrailEvidence } from '#/lib/trail-evidence'

/** The trails people saved against this record: the pages they looked at,
 * in order, kept as part of its evidence. Nothing shows when there are none. */
export function SavedTrails({ recordId }: { recordId: string }) {
  const trails = useQuery({
    queryKey: ['ui-port', 'trail-evidence', recordId],
    queryFn: () => listTrailEvidence(notebookDataClient, recordId),
  })
  const rows = trails.data ?? []
  const { userLabel } = useUserNames(
    rows.flatMap((row) => (row.saved_by_user_id ? [row.saved_by_user_id] : [])),
  )
  if (rows.length === 0) return null
  return (
    <section
      aria-label="Saved trails"
      className="border-b border-border px-6 py-3"
    >
      <h2 className="m-0 mb-1 text-section">
        Saved trails <span className="text-fg-muted">{rows.length}</span>
      </h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((row) => (
          <li key={row.id} className="text-body">
            <span className="font-medium">
              {row.saved_by_user_id
                ? userLabel(row.saved_by_user_id)
                : 'Someone'}
            </span>{' '}
            <span className="text-fg-muted">
              saved {formatDate(row.created_at)}
              {row.note ? ` · ${row.note}` : ''}
            </span>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-label text-fg-muted">
              {row.steps.map((step, index) => (
                <span key={`${step.href}-${index}`}>
                  {index > 0 ? '→ ' : ''}
                  <a className="text-link underline" href={step.href}>
                    {step.identifier ?? step.title}
                  </a>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
