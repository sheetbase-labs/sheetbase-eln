/**
 * LAB-05.3 — `/r/<identifier>`.
 *
 * The printed label's QR code points here; the route resolves the identifier to the
 * object it names (a record of any kind, a record's alias, or an instrument,
 * dataset, project, sheet, pipeline or analysis by its display id) and continues
 * to that object's page, so a scan lands on what the label names rather than on a
 * search or a list. An identifier that resolves to
 * nothing says so instead of silently redirecting somewhere plausible.
 */
import { useEffect } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  resolveObjectByIdentifier,
  resolvedObjectPath,
} from '#/lib/object-resolver'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

export const Route = createFileRoute('/r/$identifier')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) throw redirect(signInRedirect(location))
    return { context }
  },
  component: ResolveIdentifierRoute,
})

function ResolveIdentifierRoute() {
  const { identifier } = Route.useParams()
  const navigate = useNavigate()
  const lookup = useQuery({
    queryKey: ['ui-port', 'object-by-identifier', identifier],
    queryFn: () => resolveObjectByIdentifier(notebookDataClient, identifier),
  })

  const found = lookup.data
  const destination = found ? resolvedObjectPath(found) : null
  useEffect(() => {
    if (!destination) return
    // Every kind lands on the surface that owns it: samples and lots on the page
    // that holds their quarantine and hold state, instruments, datasets and
    // projects on their own pages, not the generic notebook record page.
    void navigate({ to: destination, replace: true })
  }, [destination, navigate])

  if (lookup.isError) {
    return (
      <EmptyState
        title={t('projects.resolveCode.failed.title')}
        description={t('projects.resolveCode.failed.body', { identifier })}
        action={
          <Button onClick={() => void lookup.refetch()}>
            {t('common.actions.tryAgain')}
          </Button>
        }
      />
    )
  }
  if (lookup.isPending || destination) {
    return (
      <p className="p-6 text-sm text-fg-muted" role="status">
        {t('projects.resolveCode.looking', { identifier })}
      </p>
    )
  }
  return (
    <EmptyState
      title={t('projects.resolveCode.none.title')}
      description={t('projects.resolveCode.none.body', { identifier })}
      action={
        <Button nativeButton={false} render={<Link to="/search" search={{}} />}>
          {t('projects.resolveCode.none.search')}
        </Button>
      }
    />
  )
}
