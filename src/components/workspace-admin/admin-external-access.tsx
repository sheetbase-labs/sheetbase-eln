import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  apiCredentialQueryKey,
  listApiCredentialsFn,
  revokeApiCredentialFn,
  rotateApiCredentialFn,
} from '#/lib/api-credential-admin'
import type { CreatedCredentialWire } from '#/lib/api-credential-admin'
import { hasCapability } from '#/lib/capability'
import { createDataClient } from '#/lib/data-client'
import { fetchConnectorDiagnosticsFn } from '#/lib/admin-platform'
import {
  connectorQueryKeys,
  describeConnectorsError,
  updateConnector,
} from '#/lib/connectors/client'
import {
  describeExtensionsError,
  disableExtension,
  enableExtension,
  extensionQueryKeys,
  listExtensions,
} from '#/lib/extensions/client'
import {
  describeWebhookAdminError,
  fetchWebhookHealthFn,
  listWebhookSubscriptionsFn,
  setWebhookSubscriptionStatusFn,
  webhookAdminKeys,
} from '#/lib/webhook-admin'
import {
  adminQueryKeys,
  fetchWorkspaceMembers,
  formatDate,
  formatRelativeTime,
} from '#/lib/workspace-admin'

const dataClient = createDataClient()

/** Rows per domain before the overview defers to the canonical section. */
const OVERVIEW_ROW_LIMIT = 8

const statusClass: Record<string, string> = {
  active: 'bg-success-wash text-success-text',
  enabled: 'bg-success-wash text-success-text',
  paused: 'bg-warning-wash text-warning-text',
  disabled: 'bg-danger-wash text-danger-text',
  installed: 'bg-muted text-muted-foreground',
  archived: 'bg-muted text-muted-foreground',
  suspended: 'bg-warning-wash text-warning-text',
  revoked: 'bg-danger-wash text-danger-text',
  expired: 'bg-warning-wash text-warning-text',
}

function credentialStatus(row: {
  revokedAt: string | null
  expiresAt: string | null
}): 'Revoked' | 'Expired' | 'Active' {
  if (row.revokedAt) return 'Revoked'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now())
    return 'Expired'
  return 'Active'
}

function PanelHeader({
  title,
  summary,
  section,
}: {
  title: string
  summary: string
  section: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </div>
      <div className="flex gap-3 text-xs">
        <Link
          to="/admin/$section"
          params={{ section }}
          search={{ model: undefined }}
        >
          Review
        </Link>
        <Link
          to="/admin/$section"
          params={{ section: 'activity' }}
          search={{ model: undefined }}
        >
          Audit trail
        </Link>
      </div>
    </div>
  )
}

export function AdminExternalAccess({
  workspaceId,
  role,
}: {
  workspaceId: string
  role: string
}) {
  const queryClient = useQueryClient()
  const canAdmin = hasCapability(role, 'workspace.admin')
  const canIntegrations = hasCapability(role, 'integrations.manage')
  const canExtensions = hasCapability(role, 'extensions.manage')

  const [rotatedCredential, setRotatedCredential] =
    useState<CreatedCredentialWire | null>(null)

  const membersQuery = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled: canAdmin,
  })
  const credentialsQuery = useQuery({
    queryKey: apiCredentialQueryKey(workspaceId),
    queryFn: () => listApiCredentialsFn({ data: { workspaceId } }),
    enabled: canAdmin,
  })
  const connectorDiagnosticsQuery = useQuery({
    queryKey: [...connectorQueryKeys.connectors, 'diagnostics', workspaceId],
    queryFn: () => fetchConnectorDiagnosticsFn({ data: { workspaceId } }),
    enabled: canIntegrations,
  })
  const webhookSubscriptionsQuery = useQuery({
    queryKey: webhookAdminKeys.subscriptions(workspaceId),
    queryFn: () => listWebhookSubscriptionsFn({ data: { workspaceId } }),
    enabled: canIntegrations,
  })
  const webhookHealthQuery = useQuery({
    queryKey: webhookAdminKeys.health(workspaceId),
    queryFn: () => fetchWebhookHealthFn({ data: { workspaceId } }),
    enabled: canIntegrations,
  })
  const extensionsQuery = useQuery({
    queryKey: extensionQueryKeys.extensions,
    queryFn: () => listExtensions(dataClient),
    enabled: canExtensions,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin-001'] })
    void queryClient.invalidateQueries({
      queryKey: connectorQueryKeys.connectors,
    })
    void queryClient.invalidateQueries({
      queryKey: extensionQueryKeys.extensions,
    })
  }

  const revokeCredential = useMutation({
    mutationFn: (credentialId: string) =>
      revokeApiCredentialFn({ data: { workspaceId, credentialId } }),
    onSuccess: () => invalidate(),
  })
  const rotateCredential = useMutation({
    mutationFn: (credentialId: string) =>
      rotateApiCredentialFn({ data: { workspaceId, credentialId } }),
    onSuccess: (created) => {
      setRotatedCredential(created)
      invalidate()
    },
  })
  const connectorToggle = useMutation({
    mutationFn: (input: { connectorId: string; status: 'active' | 'paused' }) =>
      updateConnector(dataClient, {
        workspaceId,
        connectorId: input.connectorId,
        status: input.status,
      }),
    onSuccess: () => invalidate(),
  })
  const webhookStatus = useMutation({
    mutationFn: (input: {
      subscriptionId: string
      status: 'active' | 'disabled'
    }) =>
      setWebhookSubscriptionStatusFn({
        data: { workspaceId, ...input },
      }),
    onSuccess: () => invalidate(),
  })
  const extensionToggle = useMutation({
    mutationFn: (input: { extensionId: string; enable: boolean }) =>
      input.enable
        ? enableExtension(dataClient, {
            workspaceId,
            extensionId: input.extensionId,
          })
        : disableExtension(dataClient, {
            workspaceId,
            extensionId: input.extensionId,
          }),
    onSuccess: () => invalidate(),
  })

  const error =
    membersQuery.error ??
    credentialsQuery.error ??
    connectorDiagnosticsQuery.error ??
    webhookSubscriptionsQuery.error ??
    webhookHealthQuery.error ??
    extensionsQuery.error ??
    revokeCredential.error ??
    rotateCredential.error ??
    connectorToggle.error ??
    webhookStatus.error ??
    extensionToggle.error

  function describeError(cause: unknown): string {
    const message = cause instanceof Error ? cause.message : ''
    if (
      /integrations\.manage|extensions\.manage|workspace\.admin/.test(message)
    )
      return message
    try {
      return describeConnectorsError(cause)
    } catch {
      /* fall through */
    }
    try {
      return describeExtensionsError(cause)
    } catch {
      /* fall through */
    }
    return describeWebhookAdminError(cause)
  }

  const members = membersQuery.data ?? []
  const credentials = credentialsQuery.data ?? []
  const connectors = connectorDiagnosticsQuery.data?.connectors ?? []
  const webhookSubscriptions = webhookSubscriptionsQuery.data ?? []
  const webhookHealthById = new Map(
    (webhookHealthQuery.data?.data ?? []).map((item) => [
      item.subscriptionId,
      item,
    ]),
  )
  const extensions = extensionsQuery.data ?? []

  const visiblePanels =
    (canAdmin ? 2 : 0) + (canIntegrations ? 2 : 0) + (canExtensions ? 1 : 0)

  if (visiblePanels === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        External access details require an administration capability
        (workspace.admin, integrations.manage, or extensions.manage).
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Every identity and integration that can act on this workspace from the
        outside. Lifecycle actions run through the same canonical operations as
        their home sections; every change is written to the audit trail.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(error)}
        </p>
      ) : null}
      {rotatedCredential ? (
        <div className="space-y-2 rounded-md border border-warning-border bg-warning-wash p-4 text-sm">
          <p className="font-medium">
            Replacement credential secret — shown exactly once.
          </p>
          <code className="block break-all rounded bg-background p-2">
            {rotatedCredential.secret}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRotatedCredential(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {canAdmin ? (
        <section className="space-y-3">
          <PanelHeader
            title="Members and roles"
            summary={`${members.length} members · ${members.filter((m) => m.suspendedAt).length} suspended`}
            section="users"
          />
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.slice(0, OVERVIEW_ROW_LIMIT).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-mono text-xs">
                      {member.userId.slice(0, 8)}
                    </TableCell>
                    <TableCell>{member.role}</TableCell>
                    <TableCell>
                      {member.suspendedAt ? (
                        <Badge className={statusClass.suspended}>
                          Suspended
                        </Badge>
                      ) : (
                        <Badge className={statusClass.active}>Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(member.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {!members.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No members.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          {members.length > OVERVIEW_ROW_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              +{members.length - OVERVIEW_ROW_LIMIT} more in{' '}
              <Link
                to="/admin/$section"
                params={{ section: 'users' }}
                search={{ model: undefined }}
                className="font-medium text-primary hover:underline"
              >
                Members
              </Link>
              .
            </p>
          ) : null}
        </section>
      ) : null}

      {canAdmin ? (
        <section className="space-y-3">
          <PanelHeader
            title="Service credentials"
            summary={`${credentials.filter((c) => credentialStatus(c) === 'Active').length} active · lifecycle with last use`}
            section="api-credentials"
          />
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.slice(0, OVERVIEW_ROW_LIMIT).map((row) => {
                  const status = credentialStatus(row)
                  const retired = status !== 'Active'
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.name}{' '}
                        <code className="text-xs text-muted-foreground">
                          {row.displayPrefix}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusClass[status.toLowerCase()]}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.lastUsedAt
                          ? formatRelativeTime(row.lastUsedAt)
                          : 'Never'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.expiresAt ? formatDate(row.expiresAt) : 'Never'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={retired || rotateCredential.isPending}
                            onClick={() => rotateCredential.mutate(row.id)}
                          >
                            Rotate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              row.revokedAt != null ||
                              revokeCredential.isPending
                            }
                            onClick={() => revokeCredential.mutate(row.id)}
                          >
                            Revoke
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {!credentials.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No service credentials.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          {credentials.length > OVERVIEW_ROW_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              +{credentials.length - OVERVIEW_ROW_LIMIT} more in{' '}
              <Link
                to="/admin/$section"
                params={{ section: 'api-credentials' }}
                search={{ model: undefined }}
                className="font-medium text-primary hover:underline"
              >
                API
              </Link>
              .
            </p>
          ) : null}
        </section>
      ) : null}

      {canIntegrations ? (
        <section className="space-y-3">
          <PanelHeader
            title="Connectors"
            summary={`${connectors.filter((c) => c.status === 'active').length} active · status with last run`}
            section="connectors"
          />
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Secrets</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.slice(0, OVERVIEW_ROW_LIMIT).map((connector) => (
                  <TableRow key={connector.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/settings/integrations/$connectorId"
                        params={{ connectorId: connector.id }}
                        className="hover:underline"
                      >
                        {connector.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusClass[connector.status] ?? ''}>
                        {connector.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatRelativeTime(connector.lastRunAt)}
                      {connector.lastRunStatus
                        ? ` · ${connector.lastRunStatus}`
                        : ''}
                      {connector.lastErrorCode
                        ? ` (${connector.lastErrorCode})`
                        : ''}
                    </TableCell>
                    <TableCell className="text-xs">
                      {connector.hasSecrets ? 'Configured' : 'Missing'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          connectorToggle.isPending ||
                          connector.status === 'archived'
                        }
                        onClick={() =>
                          connectorToggle.mutate({
                            connectorId: connector.id,
                            status:
                              connector.status === 'active'
                                ? 'paused'
                                : 'active',
                          })
                        }
                      >
                        {connector.status === 'active' ? 'Disable' : 'Enable'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!connectors.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No connectors configured.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {canIntegrations ? (
        <section className="space-y-3">
          <PanelHeader
            title="Webhooks"
            summary={`${webhookSubscriptions.filter((s) => s.status === 'active').length} active · endpoint health 24h`}
            section="webhooks"
          />
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Success 24h</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhookSubscriptions
                  .slice(0, OVERVIEW_ROW_LIMIT)
                  .map((subscription) => {
                    const health = webhookHealthById.get(subscription.id)
                    const autoDisabled =
                      subscription.status === 'disabled' &&
                      subscription.failureThreshold > 0 &&
                      subscription.consecutiveFailures >=
                        subscription.failureThreshold
                    return (
                      <TableRow key={subscription.id}>
                        <TableCell className="font-medium">
                          {subscription.key}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={statusClass[subscription.status] ?? ''}
                          >
                            {autoDisabled
                              ? 'Auto-disabled'
                              : subscription.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {health == null
                            ? '—'
                            : health.successRate24h == null
                              ? 'No traffic 24h'
                              : `${(health.successRate24h * 100).toFixed(1)}% (${health.delivered24h}/${health.total24h})`}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs">
                          {health?.lastError
                            ? [health.lastError.code, health.lastError.message]
                                .filter(Boolean)
                                .join(' — ')
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {subscription.status === 'archived' ? null : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={webhookStatus.isPending}
                              onClick={() =>
                                webhookStatus.mutate({
                                  subscriptionId: subscription.id,
                                  status:
                                    subscription.status === 'active'
                                      ? 'disabled'
                                      : 'active',
                                })
                              }
                            >
                              {subscription.status === 'active'
                                ? 'Disable'
                                : 'Enable'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                {!webhookSubscriptions.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No webhook subscriptions.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {canExtensions ? (
        <section className="space-y-3">
          <PanelHeader
            title="Extensions"
            summary={`${extensions.filter((e) => e.status === 'enabled').length} enabled · install status`}
            section="extensions"
          />
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extensions.slice(0, OVERVIEW_ROW_LIMIT).map((extension) => (
                  <TableRow key={extension.id}>
                    <TableCell className="font-medium">
                      {extension.name}{' '}
                      <code className="text-xs text-muted-foreground">
                        {extension.key}
                      </code>
                    </TableCell>
                    <TableCell className="text-xs">
                      {extension.version}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusClass[extension.status] ?? ''}>
                        {extension.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatRelativeTime(extension.updated_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={extensionToggle.isPending}
                        onClick={() =>
                          extensionToggle.mutate({
                            extensionId: extension.id,
                            enable: extension.status !== 'enabled',
                          })
                        }
                      >
                        {extension.status === 'enabled' ? 'Disable' : 'Enable'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!extensions.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No extensions installed.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
