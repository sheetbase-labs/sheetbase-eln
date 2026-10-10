/**
 * LAB-05.3 — `/r/<identifier>`.
 *
 * The printed label's QR code points here; the route resolves the identifier to its
 * record and continues to that record's page, so a scan lands on the object the
 * label names rather than on a search or a list. An identifier that resolves to
 * nothing says so instead of silently redirecting somewhere plausible.
 */
import { useEffect } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { notebookDataClient } from '#/lib/notebook-data'
import { resolveRecordByIdentifier } from '#/lib/record-resolver'

export const Route = createFileRoute('/r/$identifier')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
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
  useEffect(() => {
    if (!recordId) return
    void navigate({
      to: '/records/$recordId',
      params: { recordId },
      replace: true,
    })
  }, [recordId, navigate])

  if (lookup.isError) {
    return (
      <EmptyState
        title="Could not look up this code"
        body={`The identifier ${identifier} could not be resolved. Check the code and try again.`}
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
      body={`No record in this workspace has the identifier ${identifier}.`}
    />
  )
}
