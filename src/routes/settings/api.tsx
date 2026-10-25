import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { ApiExample } from '#/components/v3/settings/api-example'
import {
  SettingsCredentials,
  personalTokensCopy,
  serviceCredentialsCopy,
} from '#/components/v3/settings/settings-credentials'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/v3/settings/settings-page'
import { Muted } from '#/components/v3/ui/layout'
import {
  apiCredentialQueryKey,
  createApiCredentialFn,
  listApiCredentialsFn,
  revokeApiCredentialFn,
  rotateApiCredentialFn,
} from '#/lib/api-credential-admin'
import type { CreatedCredentialWire } from '#/lib/api-credential-admin'
import {
  createPersonalTokenFn,
  listPersonalTokensFn,
  personalTokenQueryKey,
  revokePersonalTokenFn,
  rotatePersonalTokenFn,
} from '#/lib/personal-api-tokens'
import type { CreatedPersonalTokenWire } from '#/lib/personal-api-tokens'
import { SERVICE_SCOPE_GROUPS } from '#/lib/api-credential-scopes'
import type { Scope } from '#/lib/api-credential-scopes'

/** UI port (roadmap-4/ui-app3): personal API tokens and (for owners) workspace
 * service credentials, both in Settings. */
export const Route = createFileRoute('/settings/api')({
  component: ApiSettings,
})

function ApiSettings() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const isOwner = context.workspace?.role === 'owner'
  const [revealed, setRevealed] = useState<CreatedPersonalTokenWire | null>(
    null,
  )
  const [revealedService, setRevealedService] =
    useState<CreatedCredentialWire | null>(null)

  const query = useQuery({
    queryKey: personalTokenQueryKey(context.user.id, workspaceId),
    queryFn: () => listPersonalTokensFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId),
  })

  const serviceQuery = useQuery({
    queryKey: apiCredentialQueryKey(workspaceId),
    queryFn: () => listApiCredentialsFn({ data: { workspaceId } }),
    enabled: Boolean(workspaceId) && isOwner,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: personalTokenQueryKey(context.user.id, workspaceId),
    })
  const invalidateService = () =>
    queryClient.invalidateQueries({
      queryKey: apiCredentialQueryKey(workspaceId),
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

  const createService = useMutation({
    mutationFn: ({
      name,
      scopes,
      expiresAt,
    }: {
      name: string
      scopes: Scope[]
      expiresAt: string | null
    }) =>
      createApiCredentialFn({ data: { workspaceId, name, scopes, expiresAt } }),
    onSuccess: (created) => {
      setRevealedService(created)
      invalidateService()
    },
  })

  const revokeService = useMutation({
    mutationFn: (credentialId: string) =>
      revokeApiCredentialFn({ data: { workspaceId, credentialId } }),
    onSuccess: invalidateService,
  })

  const rotateService = useMutation({
    mutationFn: (credentialId: string) =>
      rotateApiCredentialFn({ data: { workspaceId, credentialId } }),
    onSuccess: (created) => {
      setRevealedService(created)
      invalidateService()
    },
  })

  const failed =
    createToken.error ??
    revokeToken.error ??
    rotateToken.error ??
    createService.error ??
    revokeService.error ??
    rotateService.error

  return (
    <>
      <SettingsHeader title="API and SDK">
        Personal tokens act as you. Workspace service credentials are managed
        here by owners.
      </SettingsHeader>
      <SettingsBody>
        {failed ? (
          <p role="alert" className="text-label text-danger-text">
            {failed instanceof Error
              ? failed.message
              : 'The token request could not be completed.'}
          </p>
        ) : null}
        {query.isLoading ? (
          <Muted>Loading…</Muted>
        ) : (
          <SettingsCredentials
            copy={personalTokensCopy}
            // The panel's own spacing: the two sections read and render as
            // they did before the consolidation (personal tokens 24px, service
            // credentials the Section default).
            className="gap-6"
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
        {isOwner ? (
          serviceQuery.isLoading ? (
            <Muted>Loading service credentials…</Muted>
          ) : (
            <SettingsCredentials
              copy={serviceCredentialsCopy}
              tokens={serviceQuery.data ?? []}
              revealed={revealedService}
              onCreate={(name, scopes, expiresAt) =>
                createService.mutate({ name, scopes, expiresAt })
              }
              onRevoke={(credentialId) => revokeService.mutate(credentialId)}
              onRotate={(credentialId) => rotateService.mutate(credentialId)}
              onDismissRevealed={() => setRevealedService(null)}
              scopeGroups={SERVICE_SCOPE_GROUPS}
            />
          )
        ) : null}
        <ApiExample />
      </SettingsBody>
    </>
  )
}
