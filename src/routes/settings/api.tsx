import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import { ApiExample } from '#/components/v3/settings/api-example'
import { SqlLogins } from '#/components/v3/settings/sql-logins'
import { useDataAccess } from '#/lib/data-access'
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
import { Tabs } from '#/components/v3/ui/tabs'
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
import { t } from '#/copy'

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
  const dataAccess = useDataAccess()
  const [credentialType, setCredentialType] = useState<'personal' | 'service'>(
    'personal',
  )
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
      <SettingsHeader title={t('settings.api.apiSdk')}>
        {t('settings.api.scopedAccessScripts')}
      </SettingsHeader>
      <SettingsBody>
        {failed ? (
          <Notice tone="bad" title={t('settings.api.tokenRequestFailed')}>
            {failed instanceof Error
              ? failed.message
              : 'The token request could not be completed.'}
          </Notice>
        ) : null}

        <div className="flex flex-col gap-3">
          {isOwner ? (
            <Tabs
              mode="state"
              variant="segment"
              label={t('settings.api.credentialType')}
              value={credentialType}
              onValueChange={(value) =>
                setCredentialType(value === 'service' ? 'service' : 'personal')
              }
              items={[
                {
                  key: 'personal',
                  label: t('settings.api.personal'),
                  count: query.data?.length,
                },
                {
                  key: 'service',
                  label: t('settings.api.service'),
                  count: serviceQuery.data?.length,
                },
              ]}
            />
          ) : null}

          {credentialType === 'personal' ? (
            query.isLoading ? (
              <Muted aria-busy="true">
                {t('settings.api.loadingPersonalTokens')}
              </Muted>
            ) : query.isError ? (
              <Notice tone="bad" title={t('settings.api.personalTokensCould')}>
                <Button
                  variant="secondary"
                  onClick={() => void query.refetch()}
                >
                  {t('common.actions.tryAgain')}
                </Button>
              </Notice>
            ) : (
              <SettingsCredentials
                key="personal"
                copy={personalTokensCopy}
                tokens={query.data ?? []}
                revealed={revealed}
                onCreate={(name, scopes, expiresAt) =>
                  createToken.mutate({ name, scopes, expiresAt })
                }
                onRevoke={(tokenId) => revokeToken.mutate(tokenId)}
                onRotate={(tokenId) => rotateToken.mutate(tokenId)}
                onDismissRevealed={() => setRevealed(null)}
              />
            )
          ) : isOwner ? (
            serviceQuery.isLoading ? (
              <Muted aria-busy="true">
                {t('settings.api.loadingServiceCredentials')}
              </Muted>
            ) : serviceQuery.isError ? (
              <Notice
                tone="bad"
                title={t('settings.api.serviceCredentialsCould')}
              >
                <Button
                  variant="secondary"
                  onClick={() => void serviceQuery.refetch()}
                >
                  {t('common.actions.tryAgain')}
                </Button>
              </Notice>
            ) : (
              <SettingsCredentials
                key="service"
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
        </div>

        {dataAccess ? <SqlLogins workspaceId={workspaceId} /> : null}

        <ApiExample />
      </SettingsBody>
    </>
  )
}
