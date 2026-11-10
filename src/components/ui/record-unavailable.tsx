import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { ProjectListFailure } from '#/components/projects/project-list'
import { Button } from '#/components/ui/button'
import { NotFoundNotice } from '#/components/ui/not-found-notice'
import { useReportMissing } from '#/components/workspace/workspace-navigation'

/**
 * The body of a record page whose record isn't there: nothing while the read
 * is in flight, a retry when the read failed, and otherwise the shared
 * not-found notice with a way back to the list. Every record page uses it, so
 * a missing record never leaves a heading over an empty page.
 */
export function RecordUnavailable({
  query,
  what,
  back,
}: {
  query: {
    isLoading: boolean
    isError: boolean
    error: unknown
    refetch: () => void
  }
  /** Lower-case noun, e.g. "sample". */
  what: string
  back: { to: LinkProps['to']; label: string }
}) {
  useReportMissing(!query.isLoading)

  if (query.isLoading) return null

  return (
    <div className="px-4 py-4 md:px-6" data-testid="record-unavailable">
      {query.isError ? (
        <ProjectListFailure
          error={query.error}
          what={what}
          onRetry={() => query.refetch()}
        />
      ) : (
        <NotFoundNotice
          what={what}
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to={back.to} />}
            >
              {back.label}
            </Button>
          }
        />
      )}
    </div>
  )
}
