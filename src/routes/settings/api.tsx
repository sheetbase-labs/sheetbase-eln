import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { SettingsApiTokens } from '#/components/v3/settings/settings-api-tokens'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { Muted } from '#/components/v3/ui/layout'
import {
  createPersonalTokenFn,
  listPersonalTokensFn,
  personalTokenQueryKey,
  revokePersonalTokenFn,
  rotatePersonalTokenFn,
} from '#/lib/personal-api-tokens'
import type { CreatedPersonalTokenWire } from '#/lib/personal-api-tokens'
import type { Scope } from '#/lib/api-credential-scopes'

/** UI port (roadmap-4/ui-app3): personal API tokens. A token acts as you; the
 * workspace service credentials are managed by owners under Administration. */
export const Route = createFileRoute('/settings/api')({
  component: ApiSettings,
})

function ApiSettings() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [revealed, setRevealed] = useState<CreatedPersonalTokenWire | null>(
    null,
  )

  const query = useQuery({
    queryKey: personalTokenQueryKey(context.user.id, workspaceId),
    queryFn: () => listPersonalTokensFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: personalTokenQueryKey(context.user.id, workspaceId),
    })

  const createToken = useMutation({
    mutationFn: ({
      name,
      scopes,
      expiresAt,
    }: {
      name: string
      scopes: Scope[]
      expiresAt: string | null
    }) =>
      createPersonalTokenFn({ data: { workspaceId, name, scopes, expiresAt } }),
    onSuccess: (created) => {
      setRevealed(created)
      invalidate()
    },
  })

  const revokeToken = useMutation({
    mutationFn: (tokenId: string) =>
      revokePersonalTokenFn({ data: { workspaceId, tokenId } }),
    onSuccess: invalidate,
  })

  const rotateToken = useMutation({
    mutationFn: (tokenId: string) =>
      rotatePersonalTokenFn({ data: { workspaceId, tokenId } }),
    onSuccess: (created) => {
      setRevealed(created)
      invalidate()
    },
  })

  return (
    <>
      <SettingsHeader title="API and SDK">
        Personal tokens act as you; workspace service credentials are managed by
        owners in{' '}
        <Link
          to="/admin/$section"
          params={{ section: 'api-credentials' }}
          search={{ model: undefined }}
        >
          Administration
        </Link>
        .
      </SettingsHeader>
      <SettingsBody>
        {createToken.isError ? (
          <p role="alert" className="text-label text-danger-text">
            {createToken.error instanceof Error
              ? createToken.error.message
              : 'Could not create the token.'}
          </p>
        ) : null}
        {query.isLoading ? (
          <Muted>Loading…</Muted>
        ) : (
          <SettingsApiTokens
            tokens={query.data ?? []}
            revealed={revealed}
            onCreate={(name, scopes, expiresAt) =>
              createToken.mutate({ name, scopes, expiresAt })
            }
            onRevoke={(tokenId) => revokeToken.mutate(tokenId)}
            onRotate={(tokenId) => rotateToken.mutate(tokenId)}
            onDismissRevealed={() => setRevealed(null)}
          />
        )}
        {query.isError ? (
          <Button variant="secondary" onClick={() => void invalidate()}>
            Retry
          </Button>
        ) : null}
      </SettingsBody>
    </>
  )
}
