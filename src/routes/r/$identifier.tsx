/**
 * LAB-05.3 — `/r/<identifier>`.
 *
 * The printed label's QR code points here; the route resolves the identifier to its
 * record and continues to that record's page, so a scan lands on the object the
 * label names rather than on a search or a list. An identifier that resolves to
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
import { recordDestination } from '#/lib/navigation'
import { resolveRecordByIdentifier } from '#/lib/record-resolver'
import { signInRedirect } from '#/lib/sign-in-redirect'

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
    queryKey: ['ui-port', 'record-by-identifier', identifier],
    queryFn: () => resolveRecordByIdentifier(notebookDataClient, identifier),
  })

  const recordId = lookup.data?.id
  const kind = lookup.data?.kind
  useEffect(() => {
    if (!recordId) return
    // Samples and lots land on the surface that owns their quarantine and hold
    // state, not the generic notebook record page.
    void navigate({
      to: recordDestination(kind ?? '', recordId),
      replace: true,
    })
  }, [recordId, kind, navigate])

  if (lookup.isError) {
    return (
      <EmptyState
        title="Could not look up this code"
        description={`The identifier ${identifier} could not be resolved. Check the code and try again.`}
        action={
          <Button onClick={() => void lookup.refetch()}>Try again</Button>
        }
      />
    )
  }
  if (lookup.isPending || recordId) {
    return (
      <p className="p-6 text-sm text-fg-muted" role="status">
        Looking up {identifier}…
      </p>
    )
  }
  return (
    <EmptyState
      title="Nothing matches this code"
      description={`No record in this workspace has the identifier ${identifier}. Check the label, or search for the record by name.`}
      action={
        <Button nativeButton={false} render={<Link to="/search" search={{}} />}>
          Search for the record
        </Button>
      }
    />
  )
}
