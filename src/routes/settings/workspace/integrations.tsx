import { useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { EmptyState } from '#/components/ui/empty-state'
import { Muted } from '#/components/ui/layout'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  SettingsBody,
  SettingsHeader,
} from '#/components/settings/settings-page'
import {
  IncomingWebhooks,
  OutgoingWebhooks,
} from '#/components/settings/webhook-sections'
import { PipelineConnections } from '#/components/settings/pipeline-connections'
import { LineageSection } from '#/components/settings/lineage-section'
import { CreateWebhookDialog } from '#/components/settings/create-webhook-dialog'
import { RemoteJobConnections } from '#/components/settings/remote-jobs'
import { RegisterConnectorDialog } from '#/components/integrations/register-connector-dialog'
import { createDataClient } from '#/lib/data-client'
import { sentenceCase } from '#/lib/sentence-case'
import { canManageSettings, canOpenSettings } from '#/lib/settings-access'
import {
  connectorQueryKeys,
  describeConnectorsError,
  listConnectors,
} from '#/lib/connectors/client'
import { t } from '#/copy'

// Register built-in instrument parsers before the catalogue renders.
import '#/lib/connectors/plate-reader'
import '#/lib/connectors/instrument-parsers'

/** UI port (roadmap-4/ui-app3): integrations moved under Settings. The connector
 * registry is real; only owners, admins and stewards register or pause. */
export const Route = createFileRoute('/settings/workspace/integrations')({
  component: IntegrationsRoute,
})

const dataClient = createDataClient()

function IntegrationsRoute() {
  const isIndex = useRouterState({
    select: (state) =>
      state.location.pathname === '/settings/workspace/integrations',
  })

  return isIndex ? <IntegrationsList /> : <Outlet />
}

type ConnectorRow = Awaited<ReturnType<typeof listConnectors>>[number]

const connectorColumns: RegistryColumn<ConnectorRow>[] = [
  {
    id: 'connector',
    header: 'Connector',
    cell: ({ row }) => (
      <Link
        to="/settings/workspace/integrations/$connectorId"
        params={{ connectorId: row.original.id }}
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => sentenceCase(row.original.connector_type),
  },
  {
    id: 'direction',
    header: 'Direction',
    cell: ({ row }) => sentenceCase(row.original.direction),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Status tone={row.original.status === 'active' ? 'ok' : 'stored'}>
        {sentenceCase(row.original.status)}
      </Status>
    ),
  },
]

function IntegrationsList() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const canManage = canManageSettings(context.workspace, 'integrations')
  const [registerOpen, setRegisterOpen] = useState(false)
  const [webhookOpen, setWebhookOpen] = useState(false)

  const connectorsQuery = useQuery({
    queryKey: connectorQueryKeys.connectors,
    queryFn: () => listConnectors(dataClient),
    enabled: Boolean(workspaceId),
  })

  const connectors = connectorsQuery.data ?? []

  return (
    <>
      <SettingsHeader
        title={t('settings.integrations.integrations')}
        count={connectors.length}
        border={false}
        actions={
          canManage ? (
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setRegisterOpen(true)}
            >
              {t('settings.integrations.registerConnector')}
            </Button>
          ) : null
        }
      >
        {t('settings.integrations.connectInstrumentsStorage')}
      </SettingsHeader>
      <div className="min-h-0 shrink-0">
        <ConnectorRegistry
          connectors={connectors}
          error={connectorsQuery.error}
          loading={connectorsQuery.isLoading}
          onRegister={canManage ? () => setRegisterOpen(true) : undefined}
        />
      </div>
      {canManage ? <OfficeEditorSection /> : null}
      {canOpenSettings(context.workspace, 'integrations') ? (
        <SettingsBody className="border-t border-border-subtle">
          <RemoteJobConnections
            workspaceId={workspaceId}
            canManage={canManage}
          />
        </SettingsBody>
      ) : null}
      {canOpenSettings(context.workspace, 'integrations') ? (
        <PipelineConnections workspaceId={workspaceId} canManage={canManage} />
      ) : null}
      {canOpenSettings(context.workspace, 'integrations') ? (
        <WorkspaceWebhooks
          workspaceId={workspaceId}
          canManage={canManage}
          dataAccess={Boolean(context.dataAccess)}
          onAddWebhook={() => setWebhookOpen(true)}
        />
      ) : null}
      {webhookOpen ? (
        <CreateWebhookDialog
          workspaceId={workspaceId}
          onClose={() => setWebhookOpen(false)}
        />
      ) : null}
      <RegisterConnectorDialog
        workspaceId={workspaceId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
    </>
  )
}

function ConnectorRegistry({
  connectors,
  error,
  loading,
  onRegister,
}: {
  connectors: ConnectorRow[]
  error: Error | null
  loading: boolean
  onRegister: (() => void) | undefined
}) {
  if (error instanceof Error) {
    return (
      <p role="alert" className="px-4 pt-4 text-label text-danger-text md:px-6">
        {describeConnectorsError(error)}
      </p>
    )
  }

  if (connectors.length) {
    return (
      <RegistryGrid
        label={t('settings.integrations.integrations')}
        rows={connectors}
        columns={connectorColumns}
        getRowId={(connector) => connector.id}
        selectable={false}
      />
    )
  }

  if (loading) {
    return (
      <Muted className="px-4 pt-4 md:px-6">
        {t('settings.integrations.loadingIntegrations')}
      </Muted>
    )
  }

  return (
    <div className="px-4 py-4 md:px-6">
      <EmptyState
        icon="pipeline"
        title={t('settings.integrations.connectorsYet')}
        description={t(
          'settings.integrations.registerInstrumentStorageDescription',
        )}
        action={
          onRegister ? (
            <Button variant="primary" icon="plus" onClick={onRegister}>
              {t('settings.integrations.registerConnector')}
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}

function WorkspaceWebhooks({
  workspaceId,
  canManage,
  dataAccess,
  onAddWebhook,
}: {
  workspaceId: string
  canManage: boolean
  dataAccess: boolean
  onAddWebhook: () => void
}) {
  return (
    <>
      <SettingsBody className="gap-3 border-t border-border-subtle pb-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section">
            {t('settings.integrations.outgoingWebhooks')}
          </h2>
          {canManage ? (
            <Button icon="plus" onClick={onAddWebhook}>
              {t('settings.integrations.addWebhook')}
            </Button>
          ) : null}
        </div>
      </SettingsBody>
      <OutgoingWebhooks workspaceId={workspaceId} />
      <SettingsBody className="gap-3 pb-0">
        <h2 className="text-section">
          {t('settings.integrations.incomingWebhooks')}
        </h2>
      </SettingsBody>
      <IncomingWebhooks workspaceId={workspaceId} />
      <LineageSection
        workspaceId={workspaceId}
        canManage={canManage}
        dataAccess={dataAccess}
      />
    </>
  )
}

/** Admin view of the optional browser editor: on, off, or not answering. */
function OfficeEditorSection() {
  const status = useQuery({
    queryKey: ['office-editor', 'status', 'check'],
    queryFn: async () => {
      const res = await fetch('/api/office-editor/status?check=1')

      if (!res.ok) throw new Error('status')

      return z
        .object({
          enabled: z.boolean(),
          reachable: z.boolean().optional(),
          editorOrigin: z.string().optional(),
        })
        .parse(await res.json())
    },
    retry: false,
  })

  const data = status.data
  const origin = data?.editorOrigin ?? ''
  let tone: Tone = 'stored'
  let label = 'Off'
  let description = t('settings.integrations.officeEditor.off')

  if (data?.enabled) {
    if (data.reachable) {
      tone = 'ok'
      label = 'On'
      description = t('settings.integrations.officeEditor.on', { origin })
    } else {
      tone = 'warn'
      label = 'Not answering'
      description = t('settings.integrations.officeEditor.unreachable', {
        origin,
      })
    }
  }

  if (status.isLoading)
    description = t('settings.integrations.officeEditor.checking')

  return (
    <SettingsBody className="gap-2 border-t border-border-subtle pb-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section">
          {t('settings.integrations.officeEditor.title')}
        </h2>
        {data ? <Status tone={tone}>{label}</Status> : null}
      </div>
      <Muted>{description}</Muted>
    </SettingsBody>
  )
}
