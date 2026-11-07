import { useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
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
import { LineageSection } from '#/components/settings/lineage-section'
import { CreateWebhookDialog } from '#/components/settings/create-webhook-dialog'
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
        {connectorsQuery.error instanceof Error ? (
          <p
            role="alert"
            className="px-4 pt-4 text-label text-danger-text md:px-6"
          >
            {describeConnectorsError(connectorsQuery.error)}
          </p>
        ) : connectors.length ? (
          <RegistryGrid
            label={t('settings.integrations.integrations')}
            rows={connectors}
            columns={connectorColumns}
            getRowId={(connector) => connector.id}
            selectable={false}
          />
        ) : connectorsQuery.isLoading ? (
          <Muted className="px-4 pt-4 md:px-6">
            {t('settings.integrations.loadingIntegrations')}
          </Muted>
        ) : (
          <div className="px-4 py-4 md:px-6">
            <EmptyState
              icon="pipeline"
              title={t('settings.integrations.connectorsYet')}
              description={t(
                'settings.integrations.registerInstrumentStorageDescription',
              )}
              action={
                canManage ? (
                  <Button
                    variant="primary"
                    icon="plus"
                    onClick={() => setRegisterOpen(true)}
                  >
                    {t('settings.integrations.registerConnector')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>
      {canManage ? <OfficeEditorSection /> : null}
      {canOpenSettings(context.workspace, 'integrations') ? (
        <>
          <SettingsBody className="gap-3 border-t border-border-subtle pb-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-section">
                {t('settings.integrations.outgoingWebhooks')}
              </h2>
              {canManage ? (
                <Button icon="plus" onClick={() => setWebhookOpen(true)}>
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
            dataAccess={Boolean(context.dataAccess)}
          />
        </>
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

/** Admin view of the optional browser editor: on, off, or not answering. */
function OfficeEditorSection() {
  const status = useQuery({
    queryKey: ['office-editor', 'status', 'check'],
    queryFn: async () => {
      const res = await fetch('/api/office-editor/status?check=1')
      if (!res.ok) throw new Error('status')
      return (await res.json()) as {
        enabled: boolean
        reachable?: boolean
        editorOrigin?: string
      }
    },
    retry: false,
  })
  const data = status.data
  const origin = data?.editorOrigin ?? ''
  return (
    <SettingsBody className="gap-2 border-t border-border-subtle pb-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section">
          {t('settings.integrations.officeEditor.title')}
        </h2>
        {data ? (
          <Status
            tone={!data.enabled ? 'stored' : data.reachable ? 'ok' : 'warn'}
          >
            {!data.enabled ? 'Off' : data.reachable ? 'On' : 'Not answering'}
          </Status>
        ) : null}
      </div>
      <Muted>
        {status.isLoading
          ? t('settings.integrations.officeEditor.checking')
          : !data?.enabled
            ? t('settings.integrations.officeEditor.off')
            : data.reachable
              ? t('settings.integrations.officeEditor.on', { origin })
              : t('settings.integrations.officeEditor.unreachable', { origin })}
      </Muted>
    </SettingsBody>
  )
}
