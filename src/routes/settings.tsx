import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { SettingsApiTokens } from '#/components/settings/settings-api-tokens'
import { Button } from '#/components/ui'
import {
  createPersonalTokenFn,
  listPersonalTokensFn,
  personalTokenQueryKey,
  revokePersonalTokenFn,
  rotatePersonalTokenFn,
} from '#/lib/personal-api-tokens'
import type { CreatedPersonalTokenWire } from '#/lib/personal-api-tokens'
import type { Scope } from '#/lib/api-credential-scopes'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [revealed, setRevealed] = useState<CreatedPersonalTokenWire | null>(
    null,
  )

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
  })

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
      createPersonalTokenFn({
        data: { workspaceId, name, scopes, expiresAt },
      }),
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
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-4" /> Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Personal API tokens act as you. Workspace service credentials are
          managed by owners in Administration.
        </p>
      </div>

      {createToken.isError && (
        <p role="alert" className="text-sm text-destructive">
          {createToken.error instanceof Error
            ? createToken.error.message
            : 'Could not create the token.'}
        </p>
      )}

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
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
        <Button
          variant="outline"
          onClick={() =>
            void queryClient.invalidateQueries({
              queryKey: personalTokenQueryKey(context.user.id, workspaceId),
            })
          }
        >
          Retry
        </Button>
      ) : null}
    </div>
  )
}
